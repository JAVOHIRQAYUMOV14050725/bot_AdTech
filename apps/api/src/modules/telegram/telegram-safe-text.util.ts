import { Context } from 'telegraf';

const DEFAULT_FALLBACK = 'Xatolik yuz berdi.';
const ERROR_FALLBACK = 'Unknown error';
const REPLY_SENT_STATE_KEY = '__adtechReplySent';

const safeJsonStringify = (value: unknown): string | null => {
    const seen = new WeakSet<object>();
    let hasCircular = false;
    try {
        const serialized = JSON.stringify(value, (_, nextValue) => {
            if (nextValue && typeof nextValue === 'object') {
                if (seen.has(nextValue)) {
                    hasCircular = true;
                    return undefined;
                }
                seen.add(nextValue);
            }
            return nextValue;
        });
        if (hasCircular) {
            return null;
        }
        return serialized ?? null;
    } catch {
        return null;
    }
};

export function telegramSafeText(input: unknown): string {
    if (typeof input === 'string') {
        return input.trim() || DEFAULT_FALLBACK;
    }

    if (input instanceof Error) {
        const message = typeof input.message === 'string' ? input.message.trim() : '';
        if (message && message !== '[object Object]') {
            return message;
        }
        const serialized = safeJsonStringify({
            name: input.name,
            message: input.message,
            cause: (input as { cause?: unknown }).cause,
        });
        return serialized || ERROR_FALLBACK;
    }

    if (input && typeof input === 'object') {
        const serialized = safeJsonStringify(input);
        if (serialized && serialized !== '{}' && serialized !== '[object Object]') {
            return serialized;
        }
        const stringified = String(input);
        if (stringified && stringified !== '[object Object]') {
            return stringified;
        }
        return DEFAULT_FALLBACK;
    }

    const fallback = String(input ?? '').trim();
    return fallback || DEFAULT_FALLBACK;
}

export function replySafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['reply']>[1],
) {
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    return ctx.reply(telegramSafeText(textOrUnknown), extra);
}

export function answerCbQuerySafe(
    ctx: Context,
    textOrUnknown?: unknown,
    extra?: Parameters<Context['answerCbQuery']>[1],
) {
    if (typeof textOrUnknown === 'undefined') {
        return ctx.answerCbQuery();
    }
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    return ctx.answerCbQuery(telegramSafeText(textOrUnknown), extra);
}

export function editMessageTextSafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['editMessageText']>[1],
) {
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    return ctx.editMessageText(telegramSafeText(textOrUnknown), extra);
}

export function hasTelegramReplyBeenSent(ctx: Context): boolean {
    return Boolean(ctx.state && (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY]);
}
