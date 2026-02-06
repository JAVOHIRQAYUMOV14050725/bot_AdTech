import { Context } from 'telegraf';

const REPLY_SENT_STATE_KEY = '__adtechReplySent';

export type TelegramLocale = 'uz' | 'en';

const FALLBACK_MESSAGES: Record<TelegramLocale, string> = {
    uz: '❌ Xatolik yuz berdi. Iltimos qayta urinib ko‘ring.',
    en: '❌ Something went wrong. Please try again.',
};

const isNonEmptyText = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    return Boolean(trimmed) && trimmed !== '[object Object]';
};

const coercePrimitiveText = (value: unknown): string | null => {
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        const text = String(value).trim();
        return text && text !== '[object Object]' ? text : null;
    }
    return null;
};

const extractMessageField = (value: unknown): string | null => {
    if (isNonEmptyText(value)) {
        return value.trim();
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractMessageField(entry))
            .filter((entry): entry is string => Boolean(entry));
        if (parts.length) {
            return parts.join('; ');
        }
        return null;
    }
    if (value && typeof value === 'object') {
        const record = value as {
            userMessage?: unknown;
            message?: unknown;
            error?: { message?: unknown };
            details?: { userMessage?: unknown; message?: unknown };
        };
        return (
            extractMessageField(record.userMessage)
            ?? extractMessageField(record.message)
            ?? extractMessageField(record.details?.userMessage)
            ?? extractMessageField(record.details?.message)
            ?? extractMessageField(record.error?.message)
        );
    }
    return null;
};

export function resolveTelegramLocale(locale?: string | null): TelegramLocale {
    if (!locale) {
        return 'uz';
    }
    const normalized = locale.toLowerCase();
    return normalized.startsWith('en') ? 'en' : 'uz';
}

export function telegramUserMessage(
    input: unknown,
    locale: TelegramLocale,
    _correlationId?: string,
): string {
    const fallback = FALLBACK_MESSAGES[locale] ?? FALLBACK_MESSAGES.uz;
    try {
        if (input instanceof Error) {
            const extracted = extractMessageField(input.message)
                ?? extractMessageField((input as { userMessage?: unknown }).userMessage)
                ?? extractMessageField((input as { cause?: unknown }).cause);
            if (extracted) {
                return extracted;
            }
        }

        const primitive = coercePrimitiveText(input);
        if (primitive) {
            return primitive;
        }

        const extracted = extractMessageField(input);
        if (extracted) {
            return extracted;
        }
    } catch {
        return fallback;
    }
    return fallback;
}

export function replySafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['reply']>[1],
) {
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.reply(telegramUserMessage(textOrUnknown, locale), extra);
}

export function answerCbQuerySafe(
    ctx: Context,
    textOrUnknown?: unknown,
    extra?: Parameters<Context['answerCbQuery']>[1],
) {
    if (typeof textOrUnknown === 'undefined') {
        if (ctx.state) {
            (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
        }
        return ctx.answerCbQuery();
    }
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.answerCbQuery(telegramUserMessage(textOrUnknown, locale), extra);
}

export function editMessageTextSafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['editMessageText']>[1],
) {
    if (ctx.state) {
        (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY] = true;
    }
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.editMessageText(telegramUserMessage(textOrUnknown, locale), extra);
}

export function hasTelegramReplyBeenSent(ctx: Context): boolean {
    return Boolean(ctx.state && (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY]);
}