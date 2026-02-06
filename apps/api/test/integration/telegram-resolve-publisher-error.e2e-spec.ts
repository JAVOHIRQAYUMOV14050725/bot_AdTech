import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';

describe('Telegram resolve publisher error handling', () => {
    it('replies once with a safe Uzbek message on resolve failure', async () => {
        const backendClient = {
            resolvePublisher: jest.fn().mockResolvedValue({
                ok: false,
                reason: 'PUBLISHER_NOT_REGISTERED',
                message: 'Publisher account not registered yet.',
            }),
        };
        const fsm = {};
        const handler = new AdvertiserHandler(fsm as any, backendClient as any);
        const reply = jest.fn().mockResolvedValue(undefined);

        const ctx = {
            from: { id: 1001 },
            message: { text: '@missing_publisher' },
            reply,
        } as any;

        await handler.onText(ctx);

        expect(reply).toHaveBeenCalledTimes(1);
        const [message] = reply.mock.calls[0];
        expect(typeof message).toBe('string');
        expect(message).toBe('❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.');
        expect(message).not.toBe('[object Object]');
    });
});
