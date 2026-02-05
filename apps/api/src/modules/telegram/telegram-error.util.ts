type TelegramBackendErrorLike = {
    code?: unknown;
    correlationId?: unknown;
    status?: unknown;
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
    const status = typeof backendError.status === 'number' ? backendError.status : null;

    return { code, correlationId, status };
}

export function mapBackendErrorToTelegramMessage(err: unknown): string {
    const { code, correlationId } = extractTelegramErrorMeta(err);
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
        case 'INVALID_TELEGRAM_INTERNAL_TOKEN':
        case 'UNAUTHORIZED':
            return '❌ Xavfsizlik tekshiruvi o‘tmadi.';
        case 'VALIDATION_FAILED':
            return '❌ Kiritilgan ma’lumot noto‘g‘ri.';
        case 'RATE_LIMITED':
            return '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.';
        default:
            return `❌ Xatolik yuz berdi. (ID: ${safeCorrelationId})`;
    }
}