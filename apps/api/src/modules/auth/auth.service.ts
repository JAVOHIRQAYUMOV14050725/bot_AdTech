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
import { ConfigType } from '@nestjs/config';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { createHash, randomBytes } from 'crypto';
import { assertInviteTokenUsable } from './invite-token.util';

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

    private generateInviteToken() {
        return randomBytes(32).toString('hex');
    }

    private buildInviteDeepLink(inviteToken: string) {
        const botUsername = this.authConfig.telegramBotUsername.replace(/^@+/, '');
        return `https://t.me/${botUsername}?start=${inviteToken}`;
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
        const { username } = params;

        const { user, inviteToken } = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId: null,
                    role: UserRole.publisher,
                    status: UserStatus.pending_telegram_link,
                    username: username ?? null,
                },
            });

            const token = this.generateInviteToken();
            await tx.userInvite.create({
                data: {
                    userId: created.id,
                    tokenHash: this.hashInviteToken(token),
                    expiresAt: this.getInviteExpiry(),
                },
            });

            await tx.wallet.create({
                data: { userId: created.id, balance: 0, currency: 'USD' },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: created.id,
                    action: 'user_invited',
                    metadata: { role: UserRole.publisher, status: UserStatus.pending_telegram_link },
                },
            });

            return { user: created, inviteToken: token };
        });

        return {
            user: {
                id: user.id,
                telegramId: user.telegramId?.toString() ?? null,
                role: user.role,
                username: user.username,
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

        const providedHash = this.hashBootstrapToken(dto.bootstrapSecret);
        const expectedHash = this.hashBootstrapToken(bootstrapToken);
        if (providedHash !== expectedHash) {
            throw new ForbiddenException('Invalid bootstrap token');
        }

        const existingState = await this.prisma.bootstrapState.findUnique({
            where: { id: 1 },
        });
        if (existingState) {
            throw new ConflictException('Super admin already bootstrapped');
        }

        const existingSuperAdmin = await this.prisma.user.findFirst({
            where: { superAdminKey: 'super_admin' },
            select: { id: true },
        });

        if (existingSuperAdmin) {
            throw new ConflictException('Super admin already exists');
        }

        const passwordHash = await this.hashPassword(dto.password);

        const user = await this.prisma.$transaction(async (tx) => {
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
                username: user.username,
            },
        };
    }

    async handleTelegramStart(params: {
        telegramId: string;
        username?: string | null;
        startPayload?: string | null;
    }) {
        const { telegramId, username, startPayload } = params;
        if (!telegramId) {
            throw new BadRequestException('Missing telegramId');
        }
        const normalizedUsername = username ? username.replace(/^@+/, '') : null;

        this.logger.log(
            {
                event: 'telegram_start_received',
                context: AuthService.name,
                data: {
                    telegramId,
                    hasStartPayload: Boolean(startPayload),
                    usernameProvided: Boolean(normalizedUsername),
                },
            },
            AuthService.name,
        );

        if (startPayload) {
            const tokenHash = this.hashInviteToken(startPayload);
            const now = new Date();

            try {
                const { user, idempotent } = await this.prisma.$transaction(async (tx) => {
                    const invite = await tx.userInvite.findUnique({
                        where: { tokenHash },
                        include: { user: true },
                    });

                    if (!invite) {
                        throw new BadRequestException('Invite token is invalid');
                    }

                    if (invite.user.role !== UserRole.publisher) {
                        throw new BadRequestException('Invite token role invalid');
                    }

                    if (invite.usedAt) {
                        if (invite.user.telegramId?.toString() === telegramId) {
                            const updateData: Prisma.UserUpdateInput = {};
                            if (invite.user.status !== UserStatus.active) {
                                updateData.status = UserStatus.active;
                            }
                            if (!invite.user.username && normalizedUsername) {
                                updateData.username = normalizedUsername;
                            }
                            const linkedUser = Object.keys(updateData).length
                                ? await tx.user.update({
                                    where: { id: invite.userId },
                                    data: updateData,
                                })
                                : invite.user;

                            return { user: linkedUser, idempotent: true };
                        }

                        this.logger.warn(
                            {
                                event: 'telegram_invite_link_conflict',
                                context: AuthService.name,
                                data: {
                                    inviteId: invite.id,
                                    telegramId,
                                    reason: 'invite_already_used',
                                },
                            },
                            AuthService.name,
                        );
                        throw new ConflictException('Invite token already used');
                    }

                    assertInviteTokenUsable({
                        usedAt: invite.usedAt,
                        expiresAt: invite.expiresAt,
                    });

                    if (invite.user.status !== UserStatus.pending_telegram_link) {
                        throw new ConflictException('Invite user is not pending telegram link');
                    }

                    const existing = await tx.user.findUnique({
                        where: { telegramId: BigInt(telegramId) },
                        select: { id: true },
                    });
                    if (existing && existing.id !== invite.userId) {
                        this.logger.warn(
                            {
                                event: 'telegram_invite_link_conflict',
                                context: AuthService.name,
                                data: {
                                    inviteId: invite.id,
                                    telegramId,
                                    reason: 'telegram_already_linked',
                                },
                            },
                            AuthService.name,
                        );
                        throw new ConflictException('Telegram account already linked');
                    }

                    const updateData: Prisma.UserUpdateInput = {
                        telegramId: BigInt(telegramId),
                        status: UserStatus.active,
                    };
                    if (!invite.user.username && normalizedUsername) {
                        updateData.username = normalizedUsername;
                    }

                    const user = await tx.user.update({
                        where: { id: invite.userId },
                        data: updateData,
                    });

                    await tx.userInvite.update({
                        where: { id: invite.id },
                        data: { usedAt: now },
                    });

                    await tx.userAuditLog.create({
                        data: {
                            userId: invite.userId,
                            action: 'telegram_linked_from_invite',
                            metadata: {
                                inviteId: invite.id,
                                telegramId,
                                username: normalizedUsername,
                            },
                        },
                    });

                    return { user, idempotent: false };
                });

                this.logger.log(
                    {
                        event: 'telegram_invite_link_success',
                        context: AuthService.name,
                        data: {
                            telegramId,
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
                        username: user.username,
                        status: user.status,
                    },
                    created: false,
                    linkedInvite: true,
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
                throw err;
            }
        }

        const existing = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(telegramId) },
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

            return {
                ok: true,
                idempotent: true,
                user: {
                    id: existing.id,
                    telegramId: existing.telegramId?.toString() ?? null,
                    role: existing.role,
                    username: existing.username,
                    status: UserStatus.active,
                },
                created: false,
                linkedInvite: false,
            };
        }

        if (!this.authConfig.allowPublicAdvertisers) {
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

                await tx.wallet.create({
                    data: { userId: user.id, balance: 0, currency: 'USD' },
                });

                await tx.userAuditLog.create({
                    data: {
                        userId: user.id,
                        action: 'user_created_from_telegram',
                        metadata: { role: user.role },
                    },
                });

                return user;
            });

            return {
                ok: true,
                idempotent: false,
                user: {
                    id: created.id,
                    telegramId: created.telegramId?.toString() ?? null,
                    role: created.role,
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
                });
                if (existingUser) {
                    return {
                        ok: true,
                        idempotent: true,
                        user: {
                            id: existingUser.id,
                            telegramId: existingUser.telegramId?.toString() ?? null,
                            role: existingUser.role,
                            username: existingUser.username,
                            status: existingUser.status,
                        },
                        created: false,
                        linkedInvite: false,
                    };
                }
                throw new ConflictException('Telegram account already linked');
            }
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
        });

        const user = superAdmin
            ? superAdmin
            : await (async () => {
                const telegramId = (await this.resolveTelegramIdentity(identifier)).telegramId;
                return this.prisma.user.findUnique({
                    where: { telegramId: BigInt(telegramId) },
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
            select: { id: true, telegramId: true, username: true, role: true, status: true, createdAt: true },
        });
        if (!user) throw new UnauthorizedException('User not found');

        return {
            id: user.id,
            telegramId: user.telegramId?.toString() ?? null,
            username: user.username,
            role: user.role,
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
                    telegramId: updated.telegramId?.toString() ?? null,
                    username: updated.username,
                },
            };
        });
    }
}
