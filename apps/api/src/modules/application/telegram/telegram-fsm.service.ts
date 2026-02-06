import { Injectable } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';
import { TelegramFlow, TelegramFlowStep, TelegramRole } from './telegram-fsm.types';

interface FSMContext {
    role: TelegramRole;
    flow: TelegramFlow;
    step: TelegramFlowStep;
    payload: Record<string, any>;
    state?: string;
}

const mapLegacyState = (state: string | null | undefined): { flow: TelegramFlow; step: TelegramFlowStep } => {
    switch (state) {
        case 'ADV_ADD_BALANCE_AMOUNT':
            return { flow: TelegramFlow.ADD_BALANCE, step: TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT };
        case 'ADV_CREATE_CAMPAIGN_NAME':
            return { flow: TelegramFlow.CREATE_CAMPAIGN, step: TelegramFlowStep.ADV_CREATE_CAMPAIGN_NAME };
        case 'ADV_ADDEAL_PUBLISHER':
            return { flow: TelegramFlow.CREATE_AD_DEAL, step: TelegramFlowStep.ADV_ADDEAL_PUBLISHER };
        case 'ADV_ADDEAL_AMOUNT':
            return { flow: TelegramFlow.CREATE_AD_DEAL, step: TelegramFlowStep.ADV_ADDEAL_AMOUNT };
        case 'PUB_ADD_CHANNEL_PUBLIC':
        case 'PUB_ADD_CHANNEL':
            return { flow: TelegramFlow.PUBLISHER_ONBOARDING, step: TelegramFlowStep.PUB_ADD_CHANNEL_PUBLIC };
        case 'PUB_ADD_CHANNEL_PRIVATE':
            return { flow: TelegramFlow.PUBLISHER_ONBOARDING, step: TelegramFlowStep.PUB_ADD_CHANNEL_PRIVATE };
        case 'PUB_ADDEAL_PROOF':
            return { flow: TelegramFlow.PUBLISHER_ONBOARDING, step: TelegramFlowStep.PUB_ADDEAL_PROOF };
        default:
            return { flow: TelegramFlow.NONE, step: TelegramFlowStep.NONE };
    }
};
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
                flow: TelegramFlow.NONE,
                step: TelegramFlowStep.NONE,
                payload: {},
            };
        }
        const parsed = JSON.parse(raw) as FSMContext;
        if (parsed.flow && parsed.step) {
            return parsed;
        }
        const legacy = mapLegacyState(parsed.state ?? null);
        return {
            role: parsed.role ?? null,
            flow: legacy.flow,
            step: legacy.step,
            payload: parsed.payload ?? {},
        };
    }

    async set(
        userId: number,
        role: TelegramRole,
        flow: TelegramFlow,
        step: TelegramFlowStep,
        payload: Record<string, any> = {},
    ) {
        await this.redis.getClient().set(
            this.key(userId),
            JSON.stringify({ role, flow, step, payload }),
        );
    }

    async transitionStep(
        userId: number,
        step: TelegramFlowStep,
        payload?: Record<string, any>,
    ) {
        const ctx = await this.get(userId);
        await this.set(
            userId,
            ctx.role,
            ctx.flow,
            step,
            payload ?? ctx.payload,
        );
    }

    async startFlow(
        userId: number,
        flow: TelegramFlow,
        step: TelegramFlowStep,
        payload: Record<string, any> = {},
    ) {
        const ctx = await this.get(userId);
        await this.set(userId, ctx.role, flow, step, payload);
    }

    async clearFlow(userId: number) {
        const ctx = await this.get(userId);
        await this.set(userId, ctx.role, TelegramFlow.NONE, TelegramFlowStep.NONE, {});
    }

    async reset(userId: number) {
        await this.redis.getClient().del(this.key(userId));
    }

    async updateRole(userId: number, role: TelegramRole) {
        const ctx = await this.get(userId);
        await this.set(userId, role, ctx.flow, ctx.step, ctx.payload);
        return { ...ctx, role };
    }
}
