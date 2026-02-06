import { Context } from 'telegraf';

const REPLY_SENT_STATE_KEY = '__adtechReplySent';
const CALLBACK_ACK_STATE_KEY = '__adtechCallbackAcked';

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

const ensureReplyState = (ctx: Context) => {
    if (!ctx.state) {
        (ctx as Context & { state: Record<string, unknown> }).state = {};
    }
    return ctx.state as Record<string, unknown>;
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
    const state = ensureReplyState(ctx);
    state[REPLY_SENT_STATE_KEY] = true;
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.reply(telegramUserMessage(textOrUnknown, locale), extra);
}

export function answerCbQuerySafe(
    ctx: Context,
    textOrUnknown?: unknown,
    extra?: Parameters<Context['answerCbQuery']>[1],
) {
    if (typeof textOrUnknown === 'undefined') {
        const state = ensureReplyState(ctx);
        state[REPLY_SENT_STATE_KEY] = true;
        if (state[CALLBACK_ACK_STATE_KEY]) {
            return Promise.resolve();
        }
        state[CALLBACK_ACK_STATE_KEY] = true;
        return ctx.answerCbQuery();
    }
    const state = ensureReplyState(ctx);
    state[REPLY_SENT_STATE_KEY] = true;
    if (state[CALLBACK_ACK_STATE_KEY]) {
        return Promise.resolve();
    }
    state[CALLBACK_ACK_STATE_KEY] = true;
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.answerCbQuery(telegramUserMessage(textOrUnknown, locale), extra);
}

export function editMessageTextSafe(
    ctx: Context,
    textOrUnknown: unknown,
    extra?: Parameters<Context['editMessageText']>[1],
) {
    const state = ensureReplyState(ctx);
    state[REPLY_SENT_STATE_KEY] = true;
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.editMessageText(telegramUserMessage(textOrUnknown, locale), extra);
}

export function editMessageTextByIdSafe(
    ctx: Context,
    chatId: number | string,
    messageId: number,
    textOrUnknown: unknown,
    extra?: Parameters<Context['telegram']['editMessageText']>[4],
) {
    const state = ensureReplyState(ctx);
    state[REPLY_SENT_STATE_KEY] = true;
    const locale = resolveTelegramLocale(ctx.from?.language_code);
    return ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        telegramUserMessage(textOrUnknown, locale),
        extra,
    );
}

export async function startTelegramProgress(
    ctx: Context,
    textOrUnknown: unknown = '⏳ Yuborilyapti...',
    extra?: Parameters<Context['reply']>[1],
) {
    if (typeof ctx.sendChatAction === 'function') {
        await ctx.sendChatAction('typing');
    }
    const progressMessage = await replySafe(ctx, textOrUnknown, extra);
    const chatId = progressMessage?.chat?.id ?? ctx.chat?.id;
    const messageId = progressMessage?.message_id;
    return {
        chatId,
        messageId,
        async finish(text: unknown, finishExtra?: Parameters<Context['telegram']['editMessageText']>[4]) {
            if (chatId && messageId) {
                return editMessageTextByIdSafe(ctx, chatId, messageId, text, finishExtra);
            }
            return replySafe(ctx, text, finishExtra);
        },
    };
}

export function hasTelegramReplyBeenSent(ctx: Context): boolean {
    return Boolean(ctx.state && (ctx.state as Record<string, unknown>)[REPLY_SENT_STATE_KEY]);
}

export function hasTelegramCallbackAcked(ctx: Context): boolean {
    return Boolean(ctx.state && (ctx.state as Record<string, unknown>)[CALLBACK_ACK_STATE_KEY]);
}
