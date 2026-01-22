import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_ROLES, RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

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

    async register(dto: RegisterDto) {
        if (!PUBLIC_ROLES.includes(dto.role)) {
            throw new BadRequestException('Invalid role for registration');
        }

        const telegramId = this.parseTelegramId(dto.telegramId);

        const existing = await this.prisma.user.findUnique({
            where: { telegramId },
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
                    role: dto.role,
                    status: UserStatus.active,
                    passwordHash,
                },
            });

            await tx.wallet.create({
                data: {
                    userId: created.id,
                    balance: 0,
                    currency: 'USD',
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: created.id,
                    action: 'user_registered',
                    metadata: {
                        role: dto.role,
                    },
                },
            });

            return created;
        });

        const token = this.jwtService.sign({
            sub: user.id,
            role: user.role,
        });

        return {
            accessToken: token,
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

        const user = await this.prisma.user.findUnique({
            where: { telegramId },
        });

        if (!user || !user.passwordHash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const matches = await bcrypt.compare(dto.password, user.passwordHash);
        if (!matches) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (user.status !== UserStatus.active) {
            throw new UnauthorizedException('User is not active');
        }

        const token = this.jwtService.sign({
            sub: user.id,
            role: user.role,
        });

        return {
            accessToken: token,
            user: {
                id: user.id,
                telegramId: user.telegramId.toString(),
                role: user.role,
                username: user.username,
            },
        };
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
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return {
            id: user.id,
            telegramId: user.telegramId.toString(),
            username: user.username,
            role: user.role,
            status: user.status,
            createdAt: user.createdAt,
        };
    }
}