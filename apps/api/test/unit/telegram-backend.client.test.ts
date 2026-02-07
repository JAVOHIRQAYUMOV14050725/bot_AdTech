import { parseBackendErrorResponse, toErrorMessage, BackendApiError, TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { ConfigService } from '@nestjs/config';

describe('TelegramBackendClient error parsing', () => {
    it('coerces array messages into a string', () => {
        const payload = JSON.stringify({
            message: ['first issue', 'second issue'],
            code: 'REQUEST_FAILED',
            correlationId: 'body-corr',
        });

        const parsed = parseBackendErrorResponse(payload, 'header-corr', 'req-corr', 400);

        expect(parsed.message).toBe('first issue; second issue');
        expect(parsed.correlationId).toBe('header-corr');
    });

    it('coerces object messages into safe strings', () => {
        const payload = JSON.stringify({
            error: {
                message: { detail: 'Deep failure' },
                details: { code: 'REQUEST_FAILED', message: 'Safe user text' },
            },
            correlationId: 'body-corr',
        });

        const parsed = parseBackendErrorResponse(payload, null, 'req-corr', 502);

        expect(parsed.message).not.toBe('[object Object]');
        expect(typeof parsed.message).toBe('string');
        expect(parsed.correlationId).toBe('body-corr');
        expect(parsed.userMessage).toBe('Safe user text');
    });

    it('parses nested error detail codes', () => {
        const payload = JSON.stringify({
            error: {
                message: 'Deep failure',
                details: { code: 'INVITE_NOT_FOR_YOU', userMessage: 'custom message' },
            },
            correlationId: 'corr-123',
        });

        const parsed = parseBackendErrorResponse(payload, null, 'req-corr', 400);

        expect(parsed.code).toBe('INVITE_NOT_FOR_YOU');
        expect(parsed.userMessage).toBe('custom message');
        expect(parsed.correlationId).toBe('corr-123');
    });

    it('ensures BackendApiError messages are always strings', () => {
        const message = toErrorMessage({ detail: 'Oops' }, 'fallback');
        const err = new BackendApiError({
            status: 500,
            code: 'REQUEST_FAILED',
            correlationId: 'corr-1',
            message,
            userMessage: '❌ Something went wrong.',
        });

        expect(typeof err.message).toBe('string');
        expect(err.message).not.toBe('[object Object]');
        expect(err.httpStatus).toBe(500);
        expect(err.userMessage).toBe('❌ Something went wrong.');
    });

    it('times out and throws a typed error', async () => {
        jest.useFakeTimers();
        const fetchMock = jest.fn((_url: string, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
                const error = new Error('Aborted');
                (error as Error & { name?: string }).name = 'AbortError';
                reject(error);
            });
        }));
        (global as any).fetch = fetchMock;

        const configService = {
            get: (key: string, fallback?: string) => {
                if (key === 'TELEGRAM_BACKEND_TIMEOUT_MS') {
                    return '5';
                }
                if (key === 'TELEGRAM_INTERNAL_TOKEN') {
                    return 'internal-token';
                }
                if (key === 'INTERNAL_API_TOKEN') {
                    return 'internal-api-token';
                }
                return fallback ?? '';
            },
        } as ConfigService;

        const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        const client = new TelegramBackendClient(configService, logger as any);

        const promise = client.lookupAdDeal({ adDealId: 'deal-1' });

        jest.advanceTimersByTime(10);
        await expect(promise).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        jest.useRealTimers();
    });

    it('passes through insufficient balance error code and userMessage', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: { get: jest.fn().mockReturnValue(null) },
            text: jest.fn().mockResolvedValue(JSON.stringify({
                message: 'Insufficient wallet balance',
                code: 'INSUFFICIENT_WALLET_BALANCE',
                userMessage: "❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.",
                correlationId: 'corr-400',
            })),
        });
        (global as any).fetch = fetchMock;

        const configService = {
            get: (key: string, fallback?: string) => {
                if (key === 'TELEGRAM_INTERNAL_TOKEN') {
                    return 'internal-token';
                }
                if (key === 'INTERNAL_API_TOKEN') {
                    return 'internal-api-token';
                }
                return fallback ?? '';
            },
        } as ConfigService;

        const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        const client = new TelegramBackendClient(configService, logger as any);

        await expect(client.lookupAdDeal({ adDealId: 'deal-400' })).rejects.toMatchObject({
            code: 'INSUFFICIENT_WALLET_BALANCE',
            userMessage: "❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.",
            httpStatus: 400,
        });
    });

    it('passes through payments disabled error code and userMessage', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
            headers: { get: jest.fn().mockReturnValue(null) },
            text: jest.fn().mockResolvedValue(JSON.stringify({
                message: 'Click payments are disabled',
                code: 'PAYMENTS_DISABLED',
                userMessage: '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
                correlationId: 'corr-503',
            })),
        });
        (global as any).fetch = fetchMock;

        const configService = {
            get: (key: string, fallback?: string) => {
                if (key === 'TELEGRAM_INTERNAL_TOKEN') {
                    return 'internal-token';
                }
                if (key === 'INTERNAL_API_TOKEN') {
                    return 'internal-api-token';
                }
                return fallback ?? '';
            },
        } as ConfigService;

        const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        const client = new TelegramBackendClient(configService, logger as any);

        await expect(client.createDepositIntent({
            userId: 'user-1',
            amount: '10.00',
            idempotencyKey: 'intent-1',
        })).rejects.toMatchObject({
            code: 'PAYMENTS_DISABLED',
            userMessage: '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
            httpStatus: 503,
        });
    });
});