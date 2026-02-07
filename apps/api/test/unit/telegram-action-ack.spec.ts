import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';
import { PublisherHandler } from '@/modules/telegram/handlers/publisher.handler';
import { TelegramFlow, TelegramFlowStep } from '@/modules/application/telegram/telegram-fsm.types';

describe('Telegram action ACK timing', () => {
    const buildCtx = () => ({
        from: { id: 1, language_code: 'uz' },
        chat: { id: 10 },
        update: { update_id: 1 },
        answerCbQuery: jest.fn().mockResolvedValue(undefined),
        sendChatAction: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 5 }),
        telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
        state: {},
    });

    const buildAdvertiserHandler = () => {
        const fsm = {
            startFlow: jest.fn(),
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.NONE,
                step: TelegramFlowStep.NONE,
                payload: {},
            }),
            updateRole: jest.fn(),
            set: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'user-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1', username: null },
            }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        return new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);
    };

    const buildPublisherHandler = () => {
        const fsm = {
            startFlow: jest.fn(),
            get: jest.fn().mockResolvedValue({
                role: 'publisher',
                flow: TelegramFlow.NONE,
                step: TelegramFlowStep.NONE,
                payload: {},
            }),
            updateRole: jest.fn(),
            set: jest.fn(),
            clearFlow: jest.fn(),
        };

        const backendClient = {
            ensurePublisher: jest.fn().mockResolvedValue({
                user: { id: 'user-1', role: 'publisher', roles: ['publisher'], telegramId: '1', username: null },
            }),
            verifyPublisherPrivateChannel: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const configService = {
            get: jest.fn().mockReturnValue('test_bot'),
        };

        return new PublisherHandler(fsm as any, backendClient as any, configService as any, lockService as any);
    };

    it('acks callback queries within 1s', async () => {
        jest.useFakeTimers({ now: 0 });
        let calledAt: number | null = null;

        const fsm = {
            startFlow: jest.fn(),
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                flow: TelegramFlow.NONE,
                step: TelegramFlowStep.NONE,
                payload: {},
            }),
            updateRole: jest.fn(),
            set: jest.fn(),
        };

        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'user-1', role: 'advertiser', roles: ['advertiser'], telegramId: '1', username: null },
            }),
            runWithCorrelationId: jest.fn((_, fn) => fn()),
        };

        const lockService = {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any, lockService as any);

        const ctx = {
            from: { id: 1, language_code: 'uz' },
            chat: { id: 10 },
            update: { update_id: 1 },
            answerCbQuery: jest.fn().mockImplementation(() => {
                calledAt = Date.now();
                return Promise.resolve();
            }),
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 10 }, message_id: 5 }),
            telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
            state: {},
        };

        const start = Date.now();
        const promise = handler.addBalance(ctx as any);

        jest.advanceTimersByTime(500);
        await Promise.resolve();

        expect(calledAt).not.toBeNull();
        if (calledAt === null) {
            throw new Error('answerCbQuery was not called');
        }
        expect(calledAt - start).toBeLessThanOrEqual(1000);

        await promise;
        jest.useRealTimers();
    });

    it.each([
        ['advertiser enter', (ctx: any) => buildAdvertiserHandler().enter(ctx)],
        ['advertiser addBalance', (ctx: any) => buildAdvertiserHandler().addBalance(ctx)],
        ['advertiser beginCreateAdDeal', (ctx: any) => buildAdvertiserHandler().beginCreateAdDeal(ctx)],
        ['advertiser beginCreateCampaign', (ctx: any) => buildAdvertiserHandler().beginCreateCampaign(ctx)],
        ['advertiser cancelFlow', (ctx: any) => buildAdvertiserHandler().cancelFlow(ctx)],
        ['publisher enter', (ctx: any) => buildPublisherHandler().enter(ctx)],
        ['publisher addChannel', (ctx: any) => buildPublisherHandler().addChannel(ctx)],
        ['publisher addChannelPublic', (ctx: any) => buildPublisherHandler().addChannelPublic(ctx)],
        ['publisher addChannelPrivate', (ctx: any) => buildPublisherHandler().addChannelPrivate(ctx)],
        ['publisher verifyPrivateChannel', (ctx: any) => buildPublisherHandler().verifyPrivateChannel(ctx)],
        ['publisher cancelFlow', (ctx: any) => buildPublisherHandler().cancelFlow(ctx)],
    ])('acks callback on %s', async (_label, action) => {
        const ctx = buildCtx();
        await action(ctx as any);
        expect(ctx.answerCbQuery).toHaveBeenCalled();
    });
});