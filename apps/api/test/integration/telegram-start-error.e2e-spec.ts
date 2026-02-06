jest.mock('@/modules/scheduler/queues', () => ({
    redisConnection: { host: '127.0.0.1', port: 6379 },
    postQueue: { on: jest.fn(), close: jest.fn() },
    postDlq: { on: jest.fn(), close: jest.fn() },
    channelVerifyQueue: { on: jest.fn(), close: jest.fn() },
    channelVerifyDlq: { on: jest.fn(), close: jest.fn() },
}));

import { StartHandler } from '@/modules/telegram/handlers/start.handler';
import { BackendApiError } from '@/modules/telegram/telegram-backend.client';

describe('Telegram start handler error mapping', () => {
    it('maps INVITE_NOT_FOR_YOU to Uzbek message and avoids [object Object]', async () => {
        const backendClient = {
            startTelegramSession: jest.fn().mockRejectedValue(
                new BackendApiError({
                    status: 403,
                    code: 'INVITE_NOT_FOR_YOU',
                    correlationId: 'corr-123',
                    message: 'Invite token does not belong to this Telegram account.',
                }),
            ),
        };
        const fsm = {
            set: jest.fn(),
        };

        const handler = new StartHandler(fsm as any, backendClient as any);
        const reply = jest.fn().mockResolvedValue(undefined);

        const ctx = {
            from: { id: 1001, username: 'testuser' },
            update: { update_id: 42 },
            message: { text: '/start payload' },
            reply,
        } as any;

        await handler.start(ctx);

        expect(reply).toHaveBeenCalledTimes(1);
        const [message] = reply.mock.calls[0];
        expect(typeof message).toBe('string');
        expect(message).toBe('❌ Bu taklif sizga tegishli emas.');
        expect(message).not.toBe('[object Object]');
    });
});
