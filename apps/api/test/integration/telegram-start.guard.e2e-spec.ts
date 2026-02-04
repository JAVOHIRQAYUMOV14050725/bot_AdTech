import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthController } from '@/modules/auth/auth.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { authConfig } from '@/config/auth.config';
import { jwtConfig } from '@/config/jwt.config';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { TelegramInternalTokenGuard } from '@/modules/auth/guards/telegram-internal-token.guard';
import { resetDatabase } from '../utils/test-helpers';
import { ConfigService } from '@nestjs/config';

describe('Telegram start guard (e2e)', () => {
    let app: INestApplication | null = null;
    let appStarted = false;
    let prisma: PrismaService;
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
                    },
                },
                {
                    provide: 'LOGGER',
                    useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
        try {
            await prisma.$connect();
        } catch (err) {
            dbAvailable = false;
        }

        if (!dbAvailable) {
            return;
        }

        app = moduleRef.createNestApplication();
        await app.listen(0);
        const address = app.getHttpServer().address();
        const port = typeof address === 'string' ? 0 : address?.port;
        baseUrl = `http://127.0.0.1:${port}`;
        appStarted = true;
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        identityResolver.resolveUserIdentifier.mockReset();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (app && appStarted) {
            await app.close();
        }
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    it('returns 401 when missing telegram internal token', async () => {
        if (!dbAvailable) {
            return;
        }
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId: '9301' }),
        });
        expect(response.status).toBe(401);
    });

    it('returns 401 when telegram internal token is invalid', async () => {
        if (!dbAvailable) {
            return;
        }
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'wrong-token',
            },
            body: JSON.stringify({ telegramId: '9302' }),
        });
        expect(response.status).toBe(401);
    });
});
