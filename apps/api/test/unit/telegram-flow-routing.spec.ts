import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';
import { TelegramFlow, TelegramFlowStep } from '@/modules/application/telegram/telegram-fsm.types';
import { BackendApiError } from '@/modules/telegram/telegram-backend.client';
import { advertiserHome, backToAdvertiserMenuKeyboard, insufficientBalanceKeyboard } from '@/modules/telegram/keyboards';

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

    it('renders insufficient balance message with actions and avoids duplicate replies', async () => {
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.CREATE_AD_DEAL,
                step: TelegramFlowStep.ADV_ADDEAL_AMOUNT,
                payload: { publisherId: 'pub-1' },
            }),
            updateRole: jest.fn(),
            startFlow: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'adv-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1', username: 'adv' },
            }),
            createAdDeal: jest.fn().mockRejectedValue(new BackendApiError({
                status: 400,
                code: 'INSUFFICIENT_WALLET_BALANCE',
                correlationId: 'corr-1',
                message: 'Insufficient wallet balance',
                userMessage: "❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.",
            })),
            fundAdDeal: jest.fn(),
            lockAdDeal: jest.fn(),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);

        const ctx = {
            from: { id: 999, language_code: 'uz' },
            message: { text: '100' },
            chat: { id: 10 },
            update: { update_id: 456 },
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 55 }),
            telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
            state: {},
        };

        await handler.onText(ctx as any);

        expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
            10,
            55,
            undefined,
            "❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.",
            insufficientBalanceKeyboard,
        );
        expect(ctx.reply).toHaveBeenCalledTimes(1);
    });

    it('renders payments disabled message and clears add balance flow', async () => {
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.ADD_BALANCE,
                step: TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT,
                payload: {},
            }),
            updateRole: jest.fn(),
            startFlow: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'adv-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1', username: 'adv' },
            }),
            createDepositIntent: jest.fn().mockRejectedValue(new BackendApiError({
                status: 503,
                code: 'PAYMENTS_DISABLED',
                correlationId: 'corr-2',
                message: 'Click payments are disabled',
                userMessage: '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
            })),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);

        const ctx = {
            from: { id: 111, language_code: 'uz' },
            message: { text: '10' },
            chat: { id: 10 },
            update: { update_id: 789 },
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 66 }),
            telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
            state: {},
        };

        await handler.onText(ctx as any);

        expect(fsm.clearFlow).toHaveBeenCalledWith(111);
        expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
            10,
            66,
            undefined,
            '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
            backToAdvertiserMenuKeyboard,
        );
    });

    it('clears campaign flow and renders menu when campaign is unavailable', async () => {
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.CREATE_CAMPAIGN,
                step: TelegramFlowStep.ADV_CREATE_CAMPAIGN_NAME,
                payload: {},
            }),
            updateRole: jest.fn(),
            startFlow: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'adv-2', role: 'advertiser', roles: ['advertiser'], telegramId: '2', username: 'adv' },
            }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
            resolvePublisher: jest.fn(),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);

        const ctx = {
            from: { id: 222, language_code: 'uz' },
            message: { text: 'Campaign A' },
            chat: { id: 10 },
            update: { update_id: 999 },
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 77 }),
            telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
            state: {},
        };

        await handler.onText(ctx as any);

        expect(fsm.clearFlow).toHaveBeenCalledWith(222);
        expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
            10,
            77,
            undefined,
            '🛠 Campaign creation is not available yet. Please contact support.',
            advertiserHome,
        );
        expect(backendClient.resolvePublisher).not.toHaveBeenCalled();
    });
});