import { Context } from 'telegraf';

const DEFAULT_FALLBACK = 'Xatolik yuz berdi.';
const ERROR_FALLBACK = 'Unknown error';

export function telegramSafeText(input: unknown): string {
    if (typeof input === 'string') {
        return input.trim() || DEFAULT_FALLBACK;
    }

    if (input instanceof Error) {
        const message = typeof input.message === 'string' ? input.message.trim() : '';
        return message || ERROR_FALLBACK;
    }

    if (input && typeof input === 'object') {
        try {
            const serialized = JSON.stringify(input);
            if (serialized && serialized !== '{}' && serialized !== '[object Object]') {
                return serialized;
            }
        } catch {
            // ignore
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
    return ctx.answerCbQuery(telegramSafeText(textOrUnknown), extra);
}

export function editMessageTextSafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['editMessageText']>[1],
) {
    return ctx.editMessageText(telegramSafeText(textOrUnknown), extra);
}
