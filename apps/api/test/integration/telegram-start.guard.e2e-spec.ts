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
import { createHmac } from 'crypto';

describe('Telegram start guard (e2e)', () => {
    let app: INestApplication | null = null;
    let appStarted = false;
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

    const signBody = (body: Record<string, unknown>) => {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const rawBody = JSON.stringify(body);
        const signature = createHmac('sha256', 'internal-token')
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
        return { timestamp, signature };
    };

    it('returns 401 when missing telegram internal token', async () => {
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
        expect(response.status).toBe(401);
    });

    it('returns 401 when telegram internal token is invalid', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { telegramId: '9302' };
        const { timestamp, signature } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'wrong-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(401);
    });

    it('returns 401 when signature headers are missing', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { telegramId: '93025' };
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
            },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(401);
    });

    it('returns 401 when signature is invalid', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { telegramId: '9303' };
        const { timestamp } = signBody(body);
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': 'bad-signature',
            },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(401);
    });

    it('returns 401 when timestamp is expired', async () => {
        if (!dbAvailable) {
            return;
        }
        const body = { telegramId: '9304' };
        const timestamp = (Math.floor(Date.now() / 1000) - 180).toString();
        const rawBody = JSON.stringify(body);
        const signature = createHmac('sha256', 'internal-token')
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
        const response = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': timestamp,
                'X-Telegram-Signature': signature,
            },
            body: rawBody,
        });
        expect(response.status).toBe(401);
    });

    it('links invited publisher when signature is valid', async () => {
        if (!dbAvailable) {
            return;
        }
        const invite = await authService.invitePublisher({ username: 'sig_publisher' });
        const body = {
            telegramId: '9310',
            username: '@sig_publisher',
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
        expect(response.status).toBe(201);
        const payload = (await response.json()) as { user: { role: string } };
        expect(payload.user.role).toBe('publisher');
        const linkedUser = await prisma.user.findUnique({
            where: { telegramId: BigInt(9310) },
        });
        expect(linkedUser?.telegramId?.toString()).toBe('9310');
    });

    it('is idempotent on repeated telegram start', async () => {
        if (!dbAvailable) {
            return;
        }
        const invite = await authService.invitePublisher({ username: 'sig_publisher_2' });
        const body = {
            telegramId: '9311',
            username: '@sig_publisher_2',
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
        expect(response.status).toBe(201);
        const payload = (await response.json()) as { user: { id: string } };

        const { timestamp: ts2, signature: sig2 } = signBody(body);
        const replay = await fetch(`${baseUrl}/auth/telegram/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Internal-Token': 'internal-token',
                'X-Telegram-Timestamp': ts2,
                'X-Telegram-Signature': sig2,
            },
            body: JSON.stringify(body),
        });
        expect(replay.status).toBe(201);
        const replayPayload = (await replay.json()) as { user: { id: string } };
        expect(replayPayload.user.id).toBe(payload.user.id);
    });
});
