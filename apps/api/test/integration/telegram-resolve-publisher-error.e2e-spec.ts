import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';
import { TelegramFlow, TelegramFlowStep } from '@/modules/application/telegram/telegram-fsm.types';

describe('Telegram resolve publisher error handling', () => {
    it('replies once with a safe Uzbek message on resolve failure', async () => {
        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'user-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1001', username: null },
            }),
            resolvePublisher: jest.fn().mockResolvedValue({
                ok: false,
                reason: 'PUBLISHER_NOT_REGISTERED',
                message: 'Publisher account not registered yet.',
            }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.CREATE_AD_DEAL,
                step: TelegramFlowStep.ADV_ADDEAL_PUBLISHER,
                payload: {},
            }),
            updateRole: jest.fn(),
        };
        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };
        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);
        const reply = jest.fn().mockResolvedValue({ chat: { id: 1001 }, message_id: 5 });
        const editMessageText = jest.fn().mockResolvedValue(true);

        const ctx = {
            from: { id: 1001 },
            chat: { id: 1001 },
            update: { update_id: 55 },
            message: { text: '@missing_publisher' },
            reply,
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            telegram: { editMessageText },
            state: {},
        } as any;

        await handler.onText(ctx);

        expect(reply).toHaveBeenCalledTimes(1);
        expect(editMessageText).toHaveBeenCalledTimes(1);
        const [, , , message] = editMessageText.mock.calls[0];
        expect(typeof message).toBe('string');
        expect(message).toBe('❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.');
        expect(message).not.toBe('[object Object]');
    });
});