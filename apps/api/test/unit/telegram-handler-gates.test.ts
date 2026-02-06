import { AdvertiserHandler } from '@/modules/telegram/handlers/advertiser.handler';
import { PublisherHandler } from '@/modules/telegram/handlers/publisher.handler';
import { TelegramState } from '@/modules/application/telegram/telegram-fsm.types';

describe('Telegram handler role gates', () => {
    it('skips advertiser handler when FSM role is publisher', async () => {
        const backendClient = {
            ensureAdvertiser: jest.fn(),
        };
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'publisher',
                state: TelegramState.PUB_DASHBOARD,
                payload: {},
            }),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any);
        const reply = jest.fn().mockResolvedValue(undefined);

        const ctx = {
            from: { id: 777 },
            message: { text: 'hello' },
            reply,
        } as any;

        await handler.onText(ctx);

        expect(backendClient.ensureAdvertiser).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });

    it('skips publisher handler when FSM role is advertiser', async () => {
        const backendClient = {
            ensurePublisher: jest.fn(),
        };
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                state: TelegramState.ADV_DASHBOARD,
                payload: {},
            }),
        };

        const handler = new PublisherHandler(fsm as any, backendClient as any, {} as any);
        const reply = jest.fn().mockResolvedValue(undefined);

        const ctx = {
            from: { id: 888 },
            message: { text: 'hello' },
            reply,
        } as any;

        await handler.onText(ctx);

        expect(backendClient.ensurePublisher).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });

    it('does not resolve publisher when advertiser is entering amount', async () => {
        const backendClient = {
            ensureAdvertiser: jest.fn().mockResolvedValue({
                user: { id: 'adv-1', role: 'advertiser', telegramId: '1', username: 'adv' },
            }),
            resolvePublisher: jest.fn(),
            createAdDeal: jest.fn().mockResolvedValue({ id: 'deal-1', amount: '100.00' }),
            fundAdDeal: jest.fn().mockResolvedValue({ ok: true }),
            lockAdDeal: jest.fn().mockResolvedValue({ ok: true }),
        };
        const fsm = {
            get: jest.fn().mockResolvedValue({
                role: 'advertiser',
                state: TelegramState.ADV_ADDEAL_AMOUNT,
                payload: { publisherId: 'pub-1' },
            }),
            updateRole: jest.fn(),
            transition: jest.fn(),
        };

        const handler = new AdvertiserHandler(fsm as any, backendClient as any);
        const reply = jest.fn().mockResolvedValue(undefined);

        const ctx = {
            from: { id: 999 },
            message: { text: '100' },
            reply,
        } as any;

        await handler.onText(ctx);

        expect(backendClient.resolvePublisher).not.toHaveBeenCalled();
        expect(backendClient.createAdDeal).toHaveBeenCalled();
        expect(reply).toHaveBeenCalledTimes(1);
    });
});
