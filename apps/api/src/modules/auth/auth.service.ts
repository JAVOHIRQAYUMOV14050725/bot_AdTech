import { BadRequestException, Injectable, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_ROLES, RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserStatus } from '@prisma/client';
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

    private hashInviteToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private getInviteExpiry() {
        const ttlHours = this.authConfig.inviteTokenTtlHours;
        return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    }

    private generateInviteToken() {
        return randomBytes(32).toString('hex');
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

        const { user, inviteToken } = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId: null,
                    role,
                    status: UserStatus.pending_telegram_link,
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
                    metadata: { role, status: UserStatus.pending_telegram_link },
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
        };
    }

    async bootstrapSuperAdmin(dto: BootstrapSuperAdminDto) {
        const bootstrapSecret = this.authConfig.bootstrapSecret;
        if (!bootstrapSecret) {
            throw new BadRequestException('Bootstrap secret not configured');
        }

        if (dto.bootstrapSecret !== bootstrapSecret) {
            throw new ForbiddenException('Invalid bootstrap secret');
        }

        const existingSuperAdmin = await this.prisma.user.findFirst({
            where: { role: UserRole.super_admin },
            select: { id: true },
        });

        if (existingSuperAdmin) {
            throw new BadRequestException('Super admin already exists');
        }

        const resolvedIdentity = await this.resolveTelegramIdentity(dto.identifier);
        const telegramId = resolvedIdentity.telegramId;
        const existing = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(telegramId) },
            select: { id: true },
        });
        if (existing) {
            throw new BadRequestException('User already exists');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId: BigInt(telegramId),
                    username: dto.username ?? resolvedIdentity.username,
                    role: UserRole.super_admin,
                    status: UserStatus.active,
                    passwordHash,
                    passwordUpdatedAt: new Date(),
                },
            });

            await tx.wallet.create({
                data: { userId: created.id, balance: 0, currency: 'USD' },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: created.id,
                    action: 'super_admin_bootstrap',
                    metadata: { via: 'bootstrap_secret' },
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

    async consumeInviteToken(params: {
        token: string;
        telegramId: string;
        username?: string | null;
    }) {
        const { token, telegramId, username } = params;
        if (!token) {
            throw new BadRequestException('Invite token is required');
        }

        const tokenHash = this.hashInviteToken(token);
        const now = new Date();

        return this.prisma.$transaction(async (tx) => {
            const invite = await tx.userInvite.findUnique({
                where: { tokenHash },
                include: { user: true },
            });

            if (!invite) {
                throw new BadRequestException('Invite token is invalid');
            }

            assertInviteTokenUsable({
                usedAt: invite.usedAt,
                expiresAt: invite.expiresAt,
            });

            if (invite.user.role !== UserRole.publisher) {
                throw new BadRequestException('Invite token role invalid');
            }

            const existing = await tx.user.findUnique({
                where: { telegramId: BigInt(telegramId) },
                select: { id: true },
            });
            if (existing) {
                throw new BadRequestException('Telegram account already linked');
            }

            const user = await tx.user.update({
                where: { id: invite.userId },
                data: {
                    telegramId: BigInt(telegramId),
                    username: username ?? invite.user.username,
                    status: UserStatus.active,
                },
            });

            await tx.userInvite.update({
                where: { id: invite.id },
                data: { usedAt: now },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: invite.userId,
                    action: 'invite_consumed',
                    metadata: {
                        telegramId,
                        tokenHash,
                    },
                },
            });

            return user;
        });
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

        if (startPayload) {
            const user = await this.consumeInviteToken({
                token: startPayload,
                telegramId,
                username,
            });

            return {
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
            }

            return {
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

        const created = await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    telegramId: BigInt(telegramId),
                    username,
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
    }

    async login(dto: LoginDto) {
        const telegramId = (await this.resolveTelegramIdentity(dto.identifier)).telegramId;

        const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
        if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

        const matches = await bcrypt.compare(dto.password, user.passwordHash);
        if (!matches) throw new UnauthorizedException('Invalid credentials');
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

        const passwordHash = await bcrypt.hash(newPassword, 10);

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
}
