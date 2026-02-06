type TelegramBackendErrorLike = {
    code?: unknown;
    correlationId?: unknown;
    status?: unknown;
    httpStatus?: unknown;
};
export function extractTelegramErrorMeta(err: unknown): {
    code: string | null;
    correlationId: string | null;
    status: number | null;
} {
    if (!err || typeof err !== 'object') {
        return { code: null, correlationId: null, status: null };
    }

    const backendError = err as TelegramBackendErrorLike;
    const code = typeof backendError.code === 'string' ? backendError.code : null;
    const correlationId =
        typeof backendError.correlationId === 'string' ? backendError.correlationId : null;
    const status =
        typeof backendError.httpStatus === 'number'
            ? backendError.httpStatus
            : typeof backendError.status === 'number'
                ? backendError.status
                : null;

    return { code, correlationId, status };
}

export function mapBackendErrorToTelegramMessage(err: unknown): string {
    const { code, correlationId, status } = extractTelegramErrorMeta(err);
    const safeCorrelationId = correlationId ?? 'unknown';

    switch (code) {
        case 'INVITE_NOT_FOR_YOU':
            return '❌ Bu taklif sizga tegishli emas.';
        case 'USER_MUST_START_BOT_FIRST':
            return '❌ Avval botga /start bosing, so‘ng taklif yuboriladi.';
        case 'PUBLISHER_NOT_REGISTERED':
            return '❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.';
        case 'CHANNEL_NOT_APPROVED':
            return '⏳ Kanal hali marketplace’da tasdiqlanmagan. Admin ko‘rib chiqmoqda.';
        case 'CHANNEL_NOT_OWNED_BY_PUBLISHER':
            return '❌ Kanal egasi publisher akkaunt emas.';
        case 'IDENTIFIER_INVALID':
            return '❌ @username yoki t.me link noto‘g‘ri.';
        case 'INVALID_TELEGRAM_INTERNAL_TOKEN':
        case 'UNAUTHORIZED':
            return '❌ Xavfsizlik tekshiruvi o‘tmadi.';
        case 'VALIDATION_FAILED':
            return '❌ Kiritilgan ma’lumot noto‘g‘ri.';
        case 'RATE_LIMITED':
            return '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.';
        default:
            break;
    }

    if (status === 400) {
        return '❌ Kiritilgan ma’lumot noto‘g‘ri.';
    }
    if (status === 401 || status === 403) {
        return '❌ Xavfsizlik tekshiruvi o‘tmadi.';
    }
    if (status === 404) {
        return '❌ So‘rov topilmadi.';
    }
    if (status === 429) {
        return '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.';
    }
    if (typeof status === 'number' && status >= 500) {
        return `❌ Xatolik yuz berdi. (ID: ${safeCorrelationId})`;
    }

    return `❌ Xatolik yuz berdi. (ID: ${safeCorrelationId})`;
}

const extractMessageText = (value: unknown): string | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractMessageText(entry))
            .filter((entry): entry is string => Boolean(entry));
        return parts.length ? parts.join('; ') : null;
    }
    if (value && typeof value === 'object') {
        const nestedMessage = (value as { message?: unknown }).message;
        if (typeof nestedMessage !== 'undefined') {
            return extractMessageText(nestedMessage);
        }
    }
    return null;
};

export function telegramSafeErrorMessage(err: unknown): string {
    if (typeof err === 'string') {
        return err;
    }
    if (err instanceof Error) {
        return err.message || 'Unexpected error';
    }
    if (err && typeof err === 'object') {
        const httpLike = err as { getResponse?: () => unknown; response?: { data?: unknown } };
        if (typeof httpLike.getResponse === 'function') {
            const response = httpLike.getResponse();
            const extracted = extractMessageText(response);
            if (extracted) {
                return extracted;
            }
        }
        const data = httpLike.response?.data;
        const extractedData = extractMessageText(data);
        if (extractedData) {
            return extractedData;
        }
        const extracted = extractMessageText(err);
        if (extracted) {
            return extracted;
        }
    }
    return 'Unexpected error';
}