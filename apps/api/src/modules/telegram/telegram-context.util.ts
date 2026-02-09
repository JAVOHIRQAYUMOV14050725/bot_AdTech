import { randomUUID } from 'crypto';
import { Context } from 'telegraf';

const CORRELATION_ID_KEY = '__adtechCorrelationId';
const UPDATE_ID_KEY = '__adtechUpdateId';

export function resolveTelegramCorrelationId(ctx: Context): string {
    if (!ctx.state) {
        (ctx as Context & { state: Record<string, unknown> }).state = {};
    }
    const state = ctx.state as Record<string, unknown>;
    const existing = state[CORRELATION_ID_KEY];
    if (typeof existing === 'string' && existing.trim()) {
        return existing;
    }
    const updateId = ctx.update?.update_id ? ctx.update.update_id.toString() : null;
    if (updateId) {
        state[UPDATE_ID_KEY] = updateId;
    }
    const correlationId = randomUUID();
    state[CORRELATION_ID_KEY] = correlationId;
    return correlationId;
}

export function shortCorrelationId(correlationId?: string | null): string | null {
    if (!correlationId) {
        return null;
    }
    const trimmed = correlationId.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(-8);
}
