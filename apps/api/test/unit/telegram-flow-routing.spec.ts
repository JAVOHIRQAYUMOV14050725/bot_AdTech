import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';
import { TelegramFlow, TelegramFlowStep } from '@/modules/application/telegram/telegram-fsm.types';

describe('Telegram flow routing', () => {
    it('does not route addeal flow input into campaign flow', async () => {
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.CREATE_AD_DEAL,
                step: TelegramFlowStep.ADV_ADDEAL_PUBLISHER,
                payload: {},
            }),
            updateRole: jest.fn(),
            startFlow: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'user-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1', username: null },
            }),
            resolvePublisher: jest.fn().mockResolvedValue({
                ok: false,
                reason: 'IDENTIFIER_INVALID',
            }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);

        const ctx = {
            message: { text: '100' },
            from: { id: 1, language_code: 'uz' },
            chat: { id: 10 },
            update: { update_id: 123 },
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 55 }),
            telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
            state: {},
        };

        await handler.onText(ctx as any);

        expect(backendClient.resolvePublisher).toHaveBeenCalled();
        expect(fsm.startFlow).not.toHaveBeenCalledWith(
            1,
            TelegramFlow.CREATE_CAMPAIGN,
            expect.anything(),
            expect.anything(),
        );
    });
});
