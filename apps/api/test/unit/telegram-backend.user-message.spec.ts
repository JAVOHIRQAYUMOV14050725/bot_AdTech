import { BackendApiError, TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { ConfigService } from '@nestjs/config';

describe('Telegram backend userMessage propagation', () => {
    it('surfaces 503 userMessage from backend response', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
            headers: { get: jest.fn().mockReturnValue(null) },
            text: jest.fn().mockResolvedValue(JSON.stringify({
                message: 'Click invoice failed',
                code: 'CLICK_INVOICE_FAILED',
                details: { userMessage: 'Click invoice error: -406. Check merchant credentials/IP/contract.' },
            })),
        });

        const configService = {
            get: (key: string, fallback?: string) => {
                if (key === 'TELEGRAM_INTERNAL_TOKEN') return 'internal-token';
                if (key === 'INTERNAL_API_TOKEN') return 'api-token';
                return fallback ?? '';
            },
        } as ConfigService;

        const client = new TelegramBackendClient(configService, { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

        try {
            await client.createDepositIntent({ userId: 'user-1', amount: '10', idempotencyKey: 'k-1' });
            fail('Expected createDepositIntent to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(BackendApiError);
            expect(mapBackendErrorToTelegramMessage(err)).toContain('Click invoice error: -406');
        }
    });
});
