import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthController } from '@/modules/auth/auth.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { authConfig } from '@/config/auth.config';
import { jwtConfig } from '@/config/jwt.config';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { TelegramInternalTokenGuard } from '@/modules/auth/guards/telegram-internal-token.guard';
import { resetDatabase } from '../utils/test-helpers';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { UserRole, UserStatus } from '@prisma/client';

describe('Error contract gate (bot-facing)', () => {
    let app: INestApplication | null = null;
    let prisma: PrismaService;
    let authService: AuthService;
    let dbAvailable = true;
    let baseUrl = '';
    const identityResolver = {
        resolveUserIdentifier: jest.fn(),
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                PrismaService,
                AuthService,
                TelegramInternalTokenGuard,
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
                        telegramBotUsername: 'adtech_bot',
                        telegramInternalToken: 'internal-token',
                    },
                },
                {
                    provide: 'LOGGER',
                    useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            if (key === 'TELEGRAM_INTERNAL_TOKEN') {
                                return 'internal-token';
                            }
                            return undefined;
                        },
                    },
                },
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

        if (!dbAvailable) {
            return;
        }

        app = moduleRef.createNestApplication();
        app.useGlobalFilters(new AllExceptionsFilter(moduleRef.get('LOGGER')));
        await app.listen(0);
        const address = app.getHttpServer().address();
        const port = typeof address === 'string' ? 0 : address?.port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        identityResolver.resolveUserIdentifier.mockReset();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    const signBody = (body: Record<string, unknown>) => {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const rawBody = JSON.stringify(body);
        const signature = createHmac('sha256', 'internal-token')
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
        return { timestamp, signature };
    };

    const expectShape = (payload: any) => {
        expect(payload).toEqual(
            expect.objectContaining({
                statusCode: expect.any(Number),
                code: expect.any(String),
                message: expect.any(String),
                userMessage: expect.any(String),
                correlationId: expect.any(String),
            }),
        );
    };

    it('returns error shape for 401', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { telegramId: '9301' };
        const { timestamp, signature } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: JSON.stringify(body),
        });

        const payload = await response.json();
        expect(response.status).toBe(401);
        expectShape(payload);
    });

    it('returns error shape for 400', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { invalid: true };
        const { timestamp, signature } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: JSON.stringify(body),
        });

        const payload = await response.json();
        expect(response.status).toBe(400);
        expectShape(payload);
    });

    it('returns error shape for 403', async () => {
        if (!dbAvailable) {
            return;
        }
        await prisma.telegramSession.create({
            data: { telegramId: BigInt(9801), usernameNormalized: 'publisher_a' },
        });
        const invite = await authService.invitePublisher({ username: 'publisher_a' });

        const body = {
            telegramId: '9802',
            username: '@publisher_a',
            startPayload: invite.inviteToken,
        };
        const { timestamp, signature } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: JSON.stringify(body),
        });

        const payload = await response.json();
        expect(response.status).toBe(403);
        expectShape(payload);
    });

    it('returns error shape for 409', async () => {
        if (!dbAvailable) {
            return;
        }
        const superAdmin = await prisma.user.create({
            data: {
                role: UserRole.super_admin,
                status: UserStatus.active,
                telegramId: BigInt(9901),
            },
        });
        await prisma.userRoleGrant.create({
            data: { userId: superAdmin.id, role: UserRole.super_admin },
        });
        await prisma.bootstrapState.create({
            data: {
                id: 1,
                bootstrappedAt: new Date(),
                superAdminUserId: superAdmin.id,
                bootstrapTokenHash: 'hash',
            },
        });

        const body = {
            telegramId: '9902',
            username: '@another',
            startPayload: 'BOOTSTRAP',
        };
        const { timestamp, signature } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: JSON.stringify(body),
        });

        const payload = await response.json();
        expect(response.status).toBe(409);
        expectShape(payload);
    });
});
