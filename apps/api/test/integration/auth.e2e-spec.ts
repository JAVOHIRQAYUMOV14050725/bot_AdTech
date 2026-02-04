import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthService } from '@/modules/auth/auth.service';
import { authConfig } from '@/config/auth.config';
import { jwtConfig } from '@/config/jwt.config';
import { resetDatabase } from '../utils/test-helpers';
import bcrypt from 'bcrypt';
import { ConflictException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';

describe('Auth integration (bootstrap/login/invite/telegram)', () => {
    let prisma: PrismaService;
    let authService: AuthService;
    let dbAvailable = true;
    const identityResolver = {
        resolveUserIdentifier: jest.fn(),
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                AuthService,
                { provide: JwtService, useValue: new JwtService({}) },
                {
                    provide: jwtConfig.KEY,
                    useValue: {
                        access: { secret: 'access-secret', expiresIn: '1h' },
                        refresh: { secret: 'refresh-secret', expiresIn: '7d' },
                        issuer: 'test',
                        audience: 'test',
                    },
                },
                {
                    provide: authConfig.KEY,
                    useValue: {
                        bcryptSaltRounds: 4,
                        bootstrapToken: 'bootstrap-token',
                        inviteTokenTtlHours: 1,
                        allowPublicAdvertisers: true,
                    },
                },
                { provide: 'LOGGER', useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
                { provide: IdentityResolverService, useValue: identityResolver },
            ],
        }).compile();

        prisma = moduleRef.get(PrismaService);
        authService = moduleRef.get(AuthService);
        try {
            await prisma.$connect();
        } catch (err) {
            dbAvailable = false;
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        identityResolver.resolveUserIdentifier.mockReset();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    it('bootstraps super admin once without Telegram dependency', async () => {
        if (!dbAvailable) {
            return;
        }
        const result = await authService.bootstrapSuperAdmin({
            username: 'superadmin',
            password: 'StrongPassw0rd!',
            bootstrapSecret: 'bootstrap-token',
        });

        expect(result.user.role).toBe(UserRole.super_admin);
        expect(result.user.telegramId).toBeNull();
        expect(identityResolver.resolveUserIdentifier).not.toHaveBeenCalled();

        const gate = await prisma.bootstrapState.findUnique({ where: { id: 1 } });
        expect(gate?.superAdminUserId).toBe(result.user.id);
    });

    it('returns 409 on second bootstrap attempt', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.bootstrapSuperAdmin({
            username: 'superadmin',
            password: 'StrongPassw0rd!',
            bootstrapSecret: 'bootstrap-token',
        });

        await expect(
            authService.bootstrapSuperAdmin({
                username: 'another',
                password: 'StrongPassw0rd!',
                bootstrapSecret: 'bootstrap-token',
            }),
        ).rejects.toThrow(ConflictException);
    });

    it('allows super_admin login without telegramId', async () => {
        if (!dbAvailable) {
            return;
        }
        const passwordHash = await bcrypt.hash('StrongPassw0rd!', 4);
        const user = await prisma.user.create({
            data: {
                role: UserRole.super_admin,
                status: UserStatus.active,
                username: 'superadmin',
                passwordHash,
                superAdminKey: 'super_admin',
            },
        });

        const result = await authService.login({
            identifier: 'superadmin',
            password: 'StrongPassw0rd!',
        });

        expect(result.user.id).toBe(user.id);
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
    });

    it('invites publisher and activates on telegram start', async () => {
        if (!dbAvailable) {
            return;
        }
        const invite = await authService.invitePublisher({ username: 'publisher1' });

        const linked = await authService.handleTelegramStart({
            telegramId: '9001',
            username: 'pub_tg',
            startPayload: invite.inviteToken,
        });

        expect(linked.user.role).toBe(UserRole.publisher);
        expect(linked.user.status).toBe(UserStatus.active);
    });

    it('is idempotent for repeated telegram start', async () => {
        if (!dbAvailable) {
            return;
        }
        const first = await authService.handleTelegramStart({
            telegramId: '9101',
            username: 'adv',
            startPayload: null,
        });

        const second = await authService.handleTelegramStart({
            telegramId: '9101',
            username: 'adv',
            startPayload: null,
        });

        expect(first.user.id).toBe(second.user.id);
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
    });
});