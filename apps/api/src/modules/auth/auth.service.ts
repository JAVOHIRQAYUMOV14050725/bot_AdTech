import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
    ForbiddenException,
    Inject,
    ConflictException,
    LoggerService,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_ROLES, RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Prisma, UserStatus } from '@prisma/client';
import { UserRole } from '@/modules/domain/contracts';
import bcrypt from 'bcrypt';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { AuthConfig, authConfig } from '@/config/auth.config';
import { JwtConfig, jwtConfig } from '@/config/jwt.config';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { assertInviteTokenUsable } from './invite-token.util';
import { normalizeTelegramUsername } from '@/common/utils/telegram-username.util';
import { RequestContext } from '@/common/context/request-context';

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly identityResolver: IdentityResolverService,
        @Inject(jwtConfig.KEY)
        private readonly jwtConfig: JwtConfig,
        @Inject(authConfig.KEY) private readonly authConfig: AuthConfig,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

    private async resolveTelegramIdentity(identifier: string, actorId?: string) {
        if (!identifier) {
            throw new BadRequestException('Missing identifier. Provide a Telegram @username or t.me link.');
        }

        const resolved = await this.identityResolver.resolveUserIdentifier(identifier, {
            actorId,
        });
        if (!resolved.ok) {
            throw new BadRequestException(resolved.message);
        }
        return resolved.value;
    }

    private async hashToken(token: string) {
        const rounds = this.authConfig.bcryptSaltRounds;
        return bcrypt.hash(token, rounds);
    }

    private async hashPassword(password: string) {
        const rounds = this.authConfig.bcryptSaltRounds;
        return bcrypt.hash(password, rounds);
    }

    private hashInviteToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private hashBootstrapToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private getInviteExpiry() {
        const ttlHours = this.authConfig.inviteTokenTtlHours;
        return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    }

    private constantTimeEqual(left: string, right: string) {
        const leftHash = createHash('sha256').update(left).digest();
        const rightHash = createHash('sha256').update(right).digest();
        return timingSafeEqual(leftHash, rightHash);
    }

    private getBotUsername() {
        const raw = this.authConfig.telegramBotUsername;
        if (!raw) {
            throw new Error('TELEGRAM_BOT_USERNAME is required');
        }
        const cleaned = raw.replace(/^@+/, '').trim();
        if (!cleaned || cleaned.toLowerCase() === 'change_me_bot') {
            throw new Error('TELEGRAM_BOT_USERNAME is not configured');
        }
        return cleaned;
    }

    private buildInviteToken(inviteId: string) {
        const tokenKey = this.authConfig.telegramInternalToken;
        if (!tokenKey) {
            throw new Error('TELEGRAM_INTERNAL_TOKEN is required to mint invite tokens');
        }
        return createHmac('sha256', tokenKey).update(inviteId).digest('hex');
    }

    private buildInviteDeepLink(inviteToken: string) {
        const botUsername = this.getBotUsername();
        return `https://t.me/${botUsername}?start=${inviteToken}`;
    }

    private buildBootstrapDeepLink() {
        const botUsername = this.getBotUsername();
        return `https://t.me/${botUsername}?start=BOOTSTRAP`;
    }


    private extractRoles(user: { role: UserRole; roleGrants?: Array<{ role: UserRole }> }) {
    const roles = new Set<UserRole>();
    roles.add(user.role);
    user.roleGrants?.forEach((grant) => roles.add(grant.role));
    return Array.from(roles);
}

    private async ensureRoleGrant(
    tx: Prisma.TransactionClient,
    userId: string,
    role: UserRole,
) {
    await tx.userRoleGrant.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
    });
}

    private signAccessToken(user: { id: string; role: UserRole }) {
    return this.jwtService.sign(
        { sub: user.id, role: user.role, typ: 'access' },
        {
            secret: this.jwtConfig.access.secret,
            expiresIn: this.jwtConfig.access.expiresIn,
            issuer: this.jwtConfig.issuer,
            audience: this.jwtConfig.audience,
        },
    );
}

    private signRefreshToken(user: { id: string; role: UserRole }) {
    return this.jwtService.sign(
        { sub: user.id, role: user.role, typ: 'refresh' },
        {
            secret: this.jwtConfig.refresh.secret,
            expiresIn: this.jwtConfig.refresh.expiresIn,
            issuer: this.jwtConfig.issuer,
            audience: this.jwtConfig.audience,
        },
    );
}

    private computeRefreshExpiryDate(refreshToken: string): Date {
    const decoded = this.jwtService.decode(refreshToken) as
        | { exp?: number }
        | null;
    if (!decoded?.exp) {
        throw new BadRequestException('Invalid refresh token expiry');
    }
    return new Date(decoded.exp * 1000);
}

    private async persistRefreshToken(userId: string, refreshToken: string) {
    const hash = await this.hashToken(refreshToken);
    await this.prisma.user.update({
        where: { id: userId },
        data: {
            refreshTokenHash: hash,
            refreshTokenExpiresAt: this.computeRefreshExpiryDate(refreshToken),
        },
    });
}

    async register(dto: RegisterDto) {
    if (!dto.invite) {
        throw new BadRequestException('Registration is invite-only. Admins must set invite=true.');
    }

    const role = dto.role ?? UserRole.publisher;
    if (!PUBLIC_ROLES.includes(role)) {
        throw new BadRequestException('Only publisher invites can be created here.');
    }

    return this.invitePublisher({ username: undefined });
}

    async invitePublisher(params: { username?: string }) {
    const normalizedUsername = normalizeTelegramUsername(params.username);
    const now = new Date();

    const { invite, inviteToken, user, idempotent } = await this.prisma.$transaction(async (tx) => {
        const expiresAt = this.getInviteExpiry();

        const existingInvite = normalizedUsername
            ? await tx.userInvite.findFirst({
                where: {
                    intendedRole: UserRole.publisher,
                    intendedUsernameNormalized: normalizedUsername,
                    usedAt: null,
                    expiresAt: { gt: now },
                },
                orderBy: { createdAt: 'desc' },
            })
            : null;

        if (existingInvite) {
            const existingToken = this.buildInviteToken(existingInvite.id);
            const expectedHash = this.hashInviteToken(existingToken);
            const invite = existingInvite.tokenHash === expectedHash
                ? existingInvite
                : await tx.userInvite.update({
                    where: { id: existingInvite.id },
                    data: {
                        tokenHash: expectedHash,
                        intendedUsernameNormalized: normalizedUsername,
                    },
                });

            const existingUser = invite.invitedUserId
                ? await tx.user.findUnique({ where: { id: invite.invitedUserId } })
                : null;

            const user = existingUser
                ? existingUser
                : await tx.user.create({
                    data: {
                        telegramId: null,
                        username: normalizedUsername ?? null,
                        role: UserRole.publisher,
                        status: UserStatus.pending_telegram_link,
                    },
                });

            if (!existingUser) {
                await this.ensureRoleGrant(tx, user.id, UserRole.publisher);
                await tx.wallet.create({
                    data: { userId: user.id, balance: 0, currency: 'USD' },
                });
                await tx.userInvite.update({
                    where: { id: invite.id },
                    data: { invitedUserId: user.id },
                });
            }

            return { invite, inviteToken: existingToken, user, idempotent: true };
        }

        const user = await tx.user.create({
            data: {
                telegramId: null,
                username: normalizedUsername ?? null,
                role: UserRole.publisher,
                status: UserStatus.pending_telegram_link,
            },
        });

        await this.ensureRoleGrant(tx, user.id, UserRole.publisher);
        await tx.wallet.create({
            data: { userId: user.id, balance: 0, currency: 'USD' },
        });

        const inviteId = randomUUID();
        const token = this.buildInviteToken(inviteId);
        const tokenHash = this.hashInviteToken(token);

        const invite = await tx.userInvite.create({
            data: {
                id: inviteId,
                tokenHash,
                expiresAt,
                intendedRole: UserRole.publisher,
                intendedUsernameNormalized: normalizedUsername,
                invitedUserId: user.id,
            },
        });

        return { invite, inviteToken: token, user, idempotent: false };
    });

    const correlationId = RequestContext.getCorrelationId() ?? null;
    this.logger.log(
        {
            event: idempotent ? 'invite_reused' : 'invite_created',
            context: AuthService.name,
            data: {
                correlationId,
                inviteId: invite.id,
                userId: user.id,
                intendedUsernameNormalized: invite.intendedUsernameNormalized,
                expiresAt: invite.expiresAt,
            },
        },
        AuthService.name,
    );

    return {
        invite: {
            id: invite.id,
            intendedRole: invite.intendedRole,
            intendedUsernameNormalized: invite.intendedUsernameNormalized,
            expiresAt: invite.expiresAt,
        },
        user: {
            id: user.id,
            role: user.role,
            username: user.username ?? null,
            status: user.status,
        },
        inviteToken,
        deepLink: this.buildInviteDeepLink(inviteToken),
    };
}

    async bootstrapSuperAdmin(dto: BootstrapSuperAdminDto) {
    const bootstrapToken = this.authConfig.bootstrapToken;
    if (!bootstrapToken) {
        throw new BadRequestException('Bootstrap token not configured');
    }

    if (!this.constantTimeEqual(dto.bootstrapSecret, bootstrapToken)) {
        throw new ForbiddenException('Invalid bootstrap token');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const expectedHash = this.hashBootstrapToken(bootstrapToken);

    const user = await this.prisma.$transaction(async (tx) => {
        const existingState = await tx.bootstrapState.findUnique({
            where: { id: 1 },
        });
        if (existingState) {
            throw new ConflictException('Super admin already bootstrapped');
        }

        const existingSuperAdmin = await tx.user.findFirst({
            where: { superAdminKey: 'super_admin' },
            select: { id: true },
        });

        if (existingSuperAdmin) {
            throw new ConflictException('Super admin already exists');
        }

        const created = await tx.user.create({
            data: {
                telegramId: null,
                username: dto.username,
                role: UserRole.super_admin,
                superAdminKey: 'super_admin',
                status: UserStatus.active,
                passwordHash,
                passwordUpdatedAt: new Date(),
            },
        });

        await this.ensureRoleGrant(tx, created.id, UserRole.super_admin);

        await tx.wallet.create({
            data: { userId: created.id, balance: 0, currency: 'USD' },
        });

        await tx.bootstrapState.create({
            data: {
                id: 1,
                bootstrappedAt: new Date(),
                superAdminUserId: created.id,
                bootstrapTokenHash: expectedHash,
            },
        });

        await tx.userAuditLog.create({
            data: {
                userId: created.id,
                action: 'super_admin_bootstrap',
                metadata: { via: 'bootstrap_token' },
            },
        });

        return created;
    });

    return {
        user: {
            id: user.id,
            telegramId: user.telegramId?.toString() ?? null,
            role: user.role,
            roles: [user.role],
            username: user.username,
        },
        deepLink: this.buildBootstrapDeepLink(),
    };
}

    async handleTelegramStart(params: {
    telegramId: string;
    username?: string | null;
    startPayload?: string | null;
    updateId?: string | null;
}) {
    const { telegramId, username, startPayload, updateId } = params;
    if (!telegramId) {
        throw new BadRequestException('Missing telegramId');
    }
    const normalizedUsername = normalizeTelegramUsername(username);
    const correlationId = RequestContext.getCorrelationId() ?? null;
    const payloadType =
        startPayload === 'BOOTSTRAP'
            ? 'bootstrap'
            : startPayload
                ? 'invite'
                : 'none';

    this.logger.log(
        {
            event: 'telegram_start_received',
            context: AuthService.name,
            data: {
                correlationId,
                telegramId,
                updateId: updateId ?? null,
                payloadType,
                hasStartPayload: Boolean(startPayload),
                usernameProvided: Boolean(normalizedUsername),
            },
        },
        AuthService.name,
    );

    if (startPayload === 'BOOTSTRAP') {
        try {
            const { user, idempotent } = await this.prisma.$transaction(async (tx) => {
                const existing = await tx.user.findUnique({
                    where: { telegramId: BigInt(telegramId) },
                    include: { roleGrants: { select: { role: true } } },
                });

                const bootstrapState = await tx.bootstrapState.findUnique({
                    where: { id: 1 },
                });
                if (!bootstrapState) {
                    throw new ConflictException('Super admin is not bootstrapped yet');
                }

                const superAdmin = await tx.user.findUnique({
                    where: { id: bootstrapState.superAdminUserId },
                    include: { roleGrants: { select: { role: true } } },
                });

                if (!superAdmin) {
                    throw new ConflictException('Super admin not found');
                }

                if (existing && existing.id !== superAdmin.id) {
                    throw new ConflictException('Telegram account already linked');
                }

                if (superAdmin.telegramId && superAdmin.telegramId !== BigInt(telegramId)) {
                    throw new ConflictException('Super admin already linked to another Telegram account');
                }

                const updateData: Prisma.UserUpdateInput = {
                    telegramId: BigInt(telegramId),
                    status: UserStatus.active,
                };
                if (!superAdmin.username && normalizedUsername) {
                    updateData.username = normalizedUsername;
                }

                const updated = superAdmin.telegramId
                    ? superAdmin
                    : await tx.user.update({
                        where: { id: superAdmin.id },
                        data: updateData,
                        include: { roleGrants: { select: { role: true } } },
                    });

                if (!superAdmin.telegramId) {
                    await tx.userAuditLog.create({
                        data: {
                            userId: superAdmin.id,
                            action: 'super_admin_linked_to_telegram',
                            metadata: {
                                telegramId,
                                updateId: updateId ?? null,
                            },
                        },
                    });
                }

                await this.ensureRoleGrant(tx, superAdmin.id, UserRole.super_admin);

                return { user: updated, idempotent: Boolean(superAdmin.telegramId) };
            });

            this.logger.log(
                {
                    event: 'telegram_start_completed',
                    context: AuthService.name,
                    data: {
                        correlationId,
                        telegramId,
                        payloadType,
                        result: 'linked',
                        userId: user.id,
                        idempotent,
                    },
                },
                AuthService.name,
            );

            return {
                ok: true,
                idempotent,
                user: {
                    id: user.id,
                    telegramId: user.telegramId?.toString() ?? null,
                    role: user.role,
                    roles: this.extractRoles(user),
                    username: user.username,
                    status: user.status,
                },
                created: false,
                linkedInvite: false,
            };
        } catch (err) {
            this.logger.warn(
                {
                    event: 'telegram_start_rejected',
                    context: AuthService.name,
                    data: {
                        correlationId,
                        telegramId,
                        payloadType,
                        reason: err instanceof Error ? err.message : 'bootstrap_link_failed',
                    },
                },
                AuthService.name,
            );
            throw err;
        }
    }

    if (startPayload) {
        const tokenHash = this.hashInviteToken(startPayload);
        const now = new Date();

        try {
            const { user, idempotent, linkedInvite } = await this.prisma.$transaction(async (tx) => {
                const invite = await tx.userInvite.findUnique({
                    where: { tokenHash },
                });

                if (!invite) {
                    throw new BadRequestException('Invite token is invalid');
                }

                if (invite.intendedRole !== UserRole.publisher) {
                    throw new BadRequestException('Invite token role invalid');
                }

                if (invite.usedAt) {
                    if (!invite.usedByUserId) {
                        throw new ConflictException('Invite token already used');
                    }

                    const linkedUser = await tx.user.findUnique({
                        where: { id: invite.usedByUserId },
                        include: { roleGrants: { select: { role: true } } },
                    });
                    if (!linkedUser) {
                        throw new ConflictException('Invite token already used');
                    }

                    if (linkedUser.telegramId && linkedUser.telegramId !== BigInt(telegramId)) {
                        throw new ConflictException('Invite token already used');
                    }

                    const updateData: Prisma.UserUpdateInput = {};
                    if (linkedUser.status !== UserStatus.active) {
                        updateData.status = UserStatus.active;
                    }
                    if (normalizedUsername) {
                        updateData.username = normalizedUsername;
                    } else if (!linkedUser.username && invite.intendedUsernameNormalized) {
                        updateData.username = invite.intendedUsernameNormalized;
                    }
                    const updatedUser = Object.keys(updateData).length
                        ? await tx.user.update({
                            where: { id: linkedUser.id },
                            data: updateData,
                            include: { roleGrants: { select: { role: true } } },
                        })
                        : linkedUser;

                    await this.ensureRoleGrant(tx, linkedUser.id, UserRole.publisher);
                    return { user: updatedUser, idempotent: true, linkedInvite: true };
                }

                assertInviteTokenUsable({
                    usedAt: invite.usedAt,
                    expiresAt: invite.expiresAt,
                });

                const existingByTelegram = await tx.user.findUnique({
                    where: { telegramId: BigInt(telegramId) },
                    include: { roleGrants: { select: { role: true } } },
                });

                if (existingByTelegram && invite.invitedUserId && existingByTelegram.id !== invite.invitedUserId) {
                    throw new ConflictException('Telegram account already linked');
                }

                let user = invite.invitedUserId
                    ? await tx.user.findUnique({
                        where: { id: invite.invitedUserId },
                        include: { roleGrants: { select: { role: true } } },
                    })
                    : null;

                if (invite.invitedUserId && !user) {
                    throw new ConflictException('Invite user not found');
                }

                if (!user && existingByTelegram) {
                    user = existingByTelegram;
                }

                if (!user) {
                    user = await tx.user.create({
                        data: {
                            telegramId: BigInt(telegramId),
                            username: normalizedUsername ?? invite.intendedUsernameNormalized ?? null,
                            role: invite.intendedRole,
                            status: UserStatus.active,
                        },
                        include: { roleGrants: { select: { role: true } } },
                    });

                    await tx.wallet.create({
                        data: { userId: user.id, balance: 0, currency: 'USD' },
                    });
                } else {
                    if (user.telegramId && user.telegramId !== BigInt(telegramId)) {
                        throw new ConflictException('Telegram account already linked');
                    }
                    const updateData: Prisma.UserUpdateInput = {
                        telegramId: BigInt(telegramId),
                        status: UserStatus.active,
                    };
                    if (normalizedUsername) {
                        updateData.username = normalizedUsername;
                    } else if (!user.username && invite.intendedUsernameNormalized) {
                        updateData.username = invite.intendedUsernameNormalized;
                    }
                    user = await tx.user.update({
                        where: { id: user.id },
                        data: updateData,
                        include: { roleGrants: { select: { role: true } } },
                    });
                }

                await this.ensureRoleGrant(tx, user.id, invite.intendedRole);

                const userWithRoles = await tx.user.findUnique({
                    where: { id: user.id },
                    include: { roleGrants: { select: { role: true } } },
                });
                if (!userWithRoles) {
                    throw new BadRequestException('User not found after invite link');
                }

                await tx.userInvite.update({
                    where: { id: invite.id },
                    data: {
                        usedAt: now,
                        usedByUserId: userWithRoles.id,
                        invitedUserId: invite.invitedUserId ?? userWithRoles.id,
                    },
                });

                await tx.userAuditLog.create({
                    data: {
                        userId: userWithRoles.id,
                        action: 'user_linked_from_invite',
                        metadata: {
                            inviteId: invite.id,
                            telegramId,
                            username: normalizedUsername,
                            updateId: updateId ?? null,
                        },
                    },
                });

                return { user: userWithRoles, idempotent: false, linkedInvite: true };
            });

            this.logger.log(
                {
                    event: 'telegram_invite_link_success',
                    context: AuthService.name,
                    data: {
                        correlationId,
                        telegramId,
                        userId: user.id,
                        idempotent,
                    },
                },
                AuthService.name,
            );
            this.logger.log(
                {
                    event: 'telegram_start_completed',
                    context: AuthService.name,
                    data: {
                        correlationId,
                        telegramId,
                        payloadType,
                        result: 'linked',
                        userId: user.id,
                        idempotent,
                    },
                },
                AuthService.name,
            );

            return {
                ok: true,
                idempotent,
                user: {
                    id: user.id,
                    telegramId: user.telegramId?.toString() ?? null,
                    role: user.role,
                    roles: this.extractRoles(user),
                    username: user.username,
                    status: user.status,
                },
                created: false,
                linkedInvite,
            };

        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                this.logger.warn(
                    {
                        event: 'telegram_invite_link_conflict',
                        context: AuthService.name,
                        data: { telegramId, reason: 'unique_constraint' },
                    },
                    AuthService.name,
                );
                throw new ConflictException('Telegram account already linked');
            }
            this.logger.warn(
                {
                    event: 'telegram_start_rejected',
                    context: AuthService.name,
                    data: {
                        correlationId,
                        telegramId,
                        payloadType,
                        reason: err instanceof Error ? err.message : 'invite_link_failed',
                    },
                },
                AuthService.name,
            );
            throw err;
        }
    }

    const existing = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
        include: { roleGrants: { select: { role: true } } },
    });

    if (existing) {
        if (existing.status !== UserStatus.active) {
            await this.prisma.user.update({
                where: { id: existing.id },
                data: { status: UserStatus.active },
            });

            await this.prisma.userAuditLog.create({
                data: {
                    userId: existing.id,
                    action: 'telegram_linked',
                    metadata: {
                        telegramId,
                        previousStatus: existing.status,
                    },
                },
            });
        }

        this.logger.log(
            {
                event: 'telegram_start_completed',
                context: AuthService.name,
                data: {
                    correlationId,
                    telegramId,
                    payloadType,
                    result: 'ensured',
                    userId: existing.id,
                    idempotent: true,
                },
            },
            AuthService.name,
        );

        return {
            ok: true,
            idempotent: true,
            user: {
                id: existing.id,
                telegramId: existing.telegramId?.toString() ?? null,
                role: existing.role,
                roles: this.extractRoles(existing),
                username: existing.username,
                status: UserStatus.active,
            },
            created: false,
            linkedInvite: false,
        };
    }

    if (!this.authConfig.allowPublicAdvertisers) {
        this.logger.warn(
            {
                event: 'telegram_start_rejected',
                context: AuthService.name,
                data: {
                    correlationId,
                    telegramId,
                    payloadType,
                    reason: 'public_advertisers_disabled',
                },
            },
            AuthService.name,
        );
        throw new ForbiddenException('Public advertiser signups are disabled. Please request an invite.');
    }

    try {
        const created = await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    telegramId: BigInt(telegramId),
                    username: normalizedUsername,
                    role: UserRole.advertiser,
                    status: UserStatus.active,
                },
            });

            await this.ensureRoleGrant(tx, user.id, UserRole.advertiser);

            await tx.wallet.create({
                data: { userId: user.id, balance: 0, currency: 'USD' },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: user.id,
                    action: 'user_created_from_telegram',
                    metadata: { role: user.role, updateId: updateId ?? null },
                },
            });

            return user;
        });

        this.logger.log(
            {
                event: 'telegram_start_completed',
                context: AuthService.name,
                data: {
                    correlationId,
                    telegramId,
                    payloadType,
                    result: 'ensured',
                    userId: created.id,
                },
            },
            AuthService.name,
        );

        return {
            ok: true,
            idempotent: false,
            user: {
                id: created.id,
                telegramId: created.telegramId?.toString() ?? null,
                role: created.role,
                roles: [UserRole.advertiser],
                username: created.username,
                status: created.status,
            },
            created: true,
            linkedInvite: false,
        };
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const existingUser = await this.prisma.user.findUnique({
                where: { telegramId: BigInt(telegramId) },
                include: { roleGrants: { select: { role: true } } },
            });
            if (existingUser) {
                this.logger.log(
                    {
                        event: 'telegram_start_completed',
                        context: AuthService.name,
                        data: {
                            correlationId,
                            telegramId,
                            payloadType,
                            result: 'ensured',
                            userId: existingUser.id,
                            idempotent: true,
                        },
                    },
                    AuthService.name,
                );
                return {
                    ok: true,
                    idempotent: true,
                    user: {
                        id: existingUser.id,
                        telegramId: existingUser.telegramId?.toString() ?? null,
                        role: existingUser.role,
                        roles: this.extractRoles(existingUser),
                        username: existingUser.username,
                        status: existingUser.status,
                    },
                    created: false,
                    linkedInvite: false,
                };
            }
            throw new ConflictException('Telegram account already linked');
        }
        this.logger.warn(
            {
                event: 'telegram_start_rejected',
                context: AuthService.name,
                data: {
                    correlationId,
                    telegramId,
                    payloadType: 'none',
                    reason: err instanceof Error ? err.message : 'telegram_start_failed',
                },
            },
            AuthService.name,
        );
        throw err;
    }
}

    async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const normalized = identifier.startsWith('@') ? identifier.slice(1) : identifier;

    const superAdmin = await this.prisma.user.findFirst({
        where: {
            role: UserRole.super_admin,
            username: { equals: normalized, mode: 'insensitive' },
        },
        include: { roleGrants: { select: { role: true } } },
    });

    const user = superAdmin
        ? superAdmin
        : await (async () => {
            const telegramId = (await this.resolveTelegramIdentity(identifier)).telegramId;
            return this.prisma.user.findUnique({
                where: { telegramId: BigInt(telegramId) },
                include: { roleGrants: { select: { role: true } } },
            });
        })();

    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) throw new UnauthorizedException('Invalid credentials');
    if (user.role !== UserRole.super_admin && !user.telegramId) {
        throw new UnauthorizedException('Telegram account not linked. Please start the bot to link Telegram.');
    }
    if (user.status !== UserStatus.active) throw new UnauthorizedException('User is not active');

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);
    await this.persistRefreshToken(user.id, refreshToken);

    return {
        accessToken,
        refreshToken,
        user: {
            id: user.id,
            telegramId: user.telegramId?.toString() ?? null,
            role: user.role,
            roles: this.extractRoles(user),
            username: user.username,
        },
    };
}

    async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');

    let payload: any;
    try {
        payload = this.jwtService.verify(refreshToken, {
            secret: this.jwtConfig.refresh.secret,
            issuer: this.jwtConfig.issuer,
            audience: this.jwtConfig.audience,
        });
    } catch {
        throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload?.typ !== 'refresh') throw new UnauthorizedException('Invalid refresh token');

    const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true, refreshTokenHash: true, refreshTokenExpiresAt: true },
    });

    if (!user || user.status !== UserStatus.active) throw new UnauthorizedException('User not found');

    if (!user.refreshTokenHash || !user.refreshTokenExpiresAt) {
        throw new UnauthorizedException('Refresh not available');
    }

    if (user.refreshTokenExpiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('Refresh token expired');
    }

    const ok = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!ok) {
        // token reuse attack bo'lishi mumkin: revoke qilib tashla
        await this.prisma.user.update({
            where: { id: user.id },
            data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
        });
        throw new ForbiddenException('Refresh token reuse detected');
    }

    // ROTATION
    const newAccess = this.signAccessToken(user);
    const newRefresh = this.signRefreshToken(user);
    await this.persistRefreshToken(user.id, newRefresh);

    return { accessToken: newAccess, refreshToken: newRefresh };
}

    async logout(userId: string) {
    await this.prisma.user.update({
        where: { id: userId },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
    return { ok: true };
}

    async me(userId: string) {
    const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            telegramId: true,
            username: true,
            role: true,
            status: true,
            createdAt: true,
            roleGrants: { select: { role: true } },
        },
    });
    if (!user) throw new UnauthorizedException('User not found');

    return {
        id: user.id,
        telegramId: user.telegramId?.toString() ?? null,
        username: user.username,
        role: user.role,
        roles: this.extractRoles(user),
        status: user.status,
        createdAt: user.createdAt,
    };
}

    // ⚠️ DEV/ADMIN reset (password esdan chiqqanda)
    async resetPasswordByIdentifier(identifier: string, newPassword: string) {
    const telegramId = (await this.resolveTelegramIdentity(identifier)).telegramId;
    const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    if (!user) throw new BadRequestException('User not found');

    const passwordHash = await this.hashPassword(newPassword);

    await this.prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash,
            passwordUpdatedAt: new Date(),
            refreshTokenHash: null,
            refreshTokenExpiresAt: null,
        },
    });

    return { ok: true };
}

    async changeUserRole(params: { actorId: string; userId: string; role: UserRole; reason?: string }) {
    const { actorId, userId, role, reason } = params;

    return this.prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
            where: { id: userId },
        });
        if (!target) {
            throw new BadRequestException('User not found');
        }

        if (target.role === role) {
            return { ok: true, idempotent: true };
        }

        if (role === UserRole.super_admin) {
            const existing = await tx.user.findFirst({
                where: { superAdminKey: 'super_admin' },
                select: { id: true },
            });
            if (existing) {
                throw new ConflictException('Super admin already exists');
            }
        }

        const updated = await tx.user.update({
            where: { id: userId },
            data: {
                role,
                superAdminKey: role === UserRole.super_admin ? 'super_admin' : null,
            },
        });

        await this.ensureRoleGrant(tx, updated.id, role);

        const roleGrants = await tx.userRoleGrant.findMany({
            where: { userId: updated.id },
            select: { role: true },
        });

        await tx.userAuditLog.create({
            data: {
                userId: actorId,
                action: 'role_changed',
                metadata: {
                    targetUserId: userId,
                    from: target.role,
                    to: role,
                    reason: reason ?? null,
                },
            },
        });

        return {
            ok: true,
            user: {
                id: updated.id,
                role: updated.role,
                roles: this.extractRoles({ role: updated.role, roleGrants }),
                telegramId: updated.telegramId?.toString() ?? null,
                username: updated.username,
            },
        };
    });
}
}
