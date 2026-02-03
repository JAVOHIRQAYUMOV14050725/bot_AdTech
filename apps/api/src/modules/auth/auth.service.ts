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
        const role = dto.role ?? UserRole.publisher;
        if (!PUBLIC_ROLES.includes(role)) throw new BadRequestException('Invalid role for registration');

        const resolvedIdentity = await this.resolveTelegramIdentity(dto.identifier);
        const telegramId = resolvedIdentity.telegramId;

        const existing = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
        if (existing) throw new BadRequestException('User already exists');

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId: BigInt(telegramId),
                    username: dto.username ?? resolvedIdentity.username,
                    role,
                    status: UserStatus.active,
                    passwordHash,
                    passwordUpdatedAt: new Date(),
                },
            });

            await tx.wallet.create({
                data: { userId: created.id, balance: 0, currency: 'USD' },
            });

            await tx.userAuditLog.create({
                data: { userId: created.id, action: 'user_registered', metadata: { role } },
            });

            return created;
        });


        return {
            user: {
                id: user.id,
                telegramId: user.telegramId.toString(),
                role: user.role,
                username: user.username,
            },
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
                telegramId: user.telegramId.toString(),
                role: user.role,
                username: user.username,
            },
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
                telegramId: user.telegramId.toString(),
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
            telegramId: user.telegramId.toString(),
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
