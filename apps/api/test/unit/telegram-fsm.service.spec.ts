import { TelegramFSMService } from '@/modules/application/telegram/telegram-fsm.service';
import { TelegramFlow, TelegramFlowStep } from '@/modules/application/telegram/telegram-fsm.types';

class MockRedisService {
    private store = new Map<string, string>();

    getClient() {
        return {
            get: async (key: string) => this.store.get(key) ?? null,
            set: async (key: string, value: string) => {
                this.store.set(key, value);
                return 'OK';
            },
            del: async (key: string) => {
                this.store.delete(key);
                return 1;
            },
        };
    }
}

describe('TelegramFSMService', () => {
    it('starting a new flow cancels previous flow and payload', async () => {
        const service = new TelegramFSMService(new MockRedisService() as any);
        const userId = 42;

        await service.set(userId, 'advertiser', TelegramFlow.CREATE_AD_DEAL, TelegramFlowStep.ADV_ADDEAL_AMOUNT, {
            publisherId: 'pub-1',
        });

        await service.startFlow(userId, TelegramFlow.ADD_BALANCE, TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT);

        const fsm = await service.get(userId);

        expect(fsm.flow).toBe(TelegramFlow.ADD_BALANCE);
        expect(fsm.step).toBe(TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT);
        expect(fsm.payload).toEqual({});
    });
});
