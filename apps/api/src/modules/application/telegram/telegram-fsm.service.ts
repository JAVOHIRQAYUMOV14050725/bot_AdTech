import { Injectable } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';
import { TelegramRole, TelegramState } from './telegram-fsm.types';

interface FSMContext {
    role: 'advertiser' | 'publisher' | 'admin' | null;
    state: TelegramState;
    payload: Record<string, any>;
}
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

    async set(
        userId: number,
        role: TelegramRole,
        state: TelegramState,
        payload: Record<string, any> = {},
    ) {
        await this.redis.getClient().set(
            this.key(userId),
            JSON.stringify({ role, state, payload }),
        );
    }

    async transition(
        userId: number,
        state: TelegramState,
        payload?: Record<string, any>,
    ) {
        const ctx = await this.get(userId);
        await this.set(
            userId,
            ctx.role,
            state,
            payload ?? ctx.payload,
        );
    }

    async reset(userId: number) {
        await this.redis.getClient().del(this.key(userId));
    }

    async updateRole(userId: number, role: TelegramRole) {
        const ctx = await this.get(userId);
        await this.set(userId, role, ctx.state, ctx.payload);
        return { ...ctx, role };
    }
}