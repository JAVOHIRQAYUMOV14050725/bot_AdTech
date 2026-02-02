import { Injectable } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';
import { TelegramState } from './telegram-fsm.types';

interface FSMContext {
    role: 'advertiser' | 'publisher' | 'admin' | null;
    state: TelegramState;
    payload: Record<string, any>;
}

// telegram-fsm.service.ts
@Injectable()
export class TelegramFSMService {
    constructor(private readonly redis: RedisService) { }

    private key(userId: number) {
        return `tg:fsm:${userId}`;
    }

    async get(userId: number): Promise<FSMContext> {
        const raw = await this.redis.getClient().get(this.key(userId));
        if (!raw) {
            return {
                role: null,
                state: TelegramState.IDLE,
                payload: {},
            };
        }
        return JSON.parse(raw);
    }

    // 🔥 ASOSIY METHOD
    async setState(
        userId: number,
        state: TelegramState,
        payload: Record<string, any> = {},
    ) {
        const ctx = await this.get(userId);

        await this.redis.getClient().set(
            this.key(userId),
            JSON.stringify({
                role: ctx.role,
                state,
                payload,
            }),
            'EX',
            3600,
        );
    }

    // 🔐 ROLE SET
    async setRole(
        userId: number,
        role: FSMContext['role'],
        state: TelegramState,
        payload: Record<string, any> = {},
    ) {
        await this.redis.getClient().set(
            this.key(userId),
            JSON.stringify({ role, state, payload }),
            'EX',
            3600,
        );
    }

    async patch(userId: number, patch: Partial<FSMContext>) {
        const ctx = await this.get(userId);
        await this.redis.getClient().set(
            this.key(userId),
            JSON.stringify({ ...ctx, ...patch }),
            'EX',
            3600,
        );
    }

    async reset(userId: number) {
        await this.redis.getClient().del(this.key(userId));
    }
}

