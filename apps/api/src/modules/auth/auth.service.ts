import { BadRequestException, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_ROLES, RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';

const ms = (val: string) => val; // placeholder; expiresIn jwt format bo'ladi: "15m", "30d"

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    private parseTelegramId(value: string): bigint {
        try {
            return BigInt(value);
        } catch {
            throw new BadRequestException('Invalid telegramId');
        }
    }

    private async hashToken(token: string) {
        const rounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
        return bcrypt.hash(token, rounds);
    }

    private signAccessToken(user: { id: string; role: UserRole }) {
        return this.jwtService.sign(
            { sub: user.id, role: user.role, typ: 'access' },
            {
                secret: process.env.JWT_ACCESS_SECRET,
                expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
            },
        );
    }

    private signRefreshToken(user: { id: string; role: UserRole }) {
        return this.jwtService.sign(
            { sub: user.id, role: user.role, typ: 'refresh' },
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
            },
        );
    }

    private computeRefreshExpiryDate(): Date {
        // JWT o'zi expiry bilan keladi, lekin DBga ham qo'yamiz.
        const days = 30;
        const now = new Date();
        now.setDate(now.getDate() + days);
        return now;
    }

    private async persistRefreshToken(userId: string, refreshToken: string) {
        const hash = await this.hashToken(refreshToken);
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                refreshTokenHash: hash,
                refreshTokenExpiresAt: this.computeRefreshExpiryDate(),
            },
        });
    }

    async register(dto: RegisterDto) {
        const role = dto.role ?? UserRole.publisher;
        if (!PUBLIC_ROLES.includes(role)) throw new BadRequestException('Invalid role for registration');

        const telegramId = this.parseTelegramId(dto.telegramId);

        const existing = await this.prisma.user.findUnique({ where: { telegramId } });
        if (existing) throw new BadRequestException('User already exists');

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId,
                    username: dto.username,
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
        const bootstrapSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
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

        const telegramId = this.parseTelegramId(dto.telegramId);
        const existing = await this.prisma.user.findUnique({
            where: { telegramId },
            select: { id: true },
        });
        if (existing) {
            throw new BadRequestException('User already exists');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    telegramId,
                    username: dto.username,
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
        const telegramId = this.parseTelegramId(dto.telegramId);

        const user = await this.prisma.user.findUnique({ where: { telegramId } });
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
                secret: process.env.JWT_REFRESH_SECRET,
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
    async resetPasswordByTelegramId(telegramIdStr: string, newPassword: string) {
        const telegramId = this.parseTelegramId(telegramIdStr);
        const user = await this.prisma.user.findUnique({ where: { telegramId } });
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
