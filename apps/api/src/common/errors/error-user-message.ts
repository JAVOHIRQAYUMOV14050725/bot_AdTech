export type ErrorUserMessageLocale = 'uz' | 'en';

export const ERROR_USER_MESSAGES: Record<
    string,
    Record<ErrorUserMessageLocale, string>
> = {
    INVITE_NOT_FOR_YOU: {
        uz: '❌ Bu taklif sizga tegishli emas.',
        en: '❌ This invite is not for you.',
    },
    USER_MUST_START_BOT_FIRST: {
        uz: '❌ Avval botni /start qiling, so‘ng taklif yaratiladi.',
        en: '❌ Please /start the bot first, then create the invite.',
    },
    PUBLISHER_NOT_REGISTERED: {
        uz: '❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.',
        en: '❌ Publisher is not registered. Join via invite link.',
    },
    CHANNEL_NOT_APPROVED: {
        uz: '⏳ Kanal hali marketplace’da tasdiqlanmagan (pending).',
        en: '⏳ Channel is pending marketplace approval.',
    },
    CHANNEL_OWNER_NOT_PUBLISHER: {
        uz: '❌ Kanal egasi publisher akkaunt emas.',
        en: '❌ Channel owner is not a publisher account.',
    },
    IDENTIFIER_INVALID: {
        uz: '❌ @username yoki t.me link noto‘g‘ri.',
        en: '❌ Invalid @username or t.me link.',
    },
    INVALID_TELEGRAM_INTERNAL_TOKEN: {
        uz: '❌ Avtorizatsiya muvaffaqiyatsiz. Qayta kirib ko‘ring.',
        en: '❌ Authorization failed. Please sign in again.',
    },
    UNAUTHORIZED: {
        uz: '❌ Avtorizatsiya muvaffaqiyatsiz. Qayta kirib ko‘ring.',
        en: '❌ Authorization failed. Please sign in again.',
    },
    FORBIDDEN: {
        uz: '❌ Ruxsat berilmadi.',
        en: '❌ Access denied.',
    },
    VALIDATION_FAILED: {
        uz: '❌ Kiritilgan ma’lumot noto‘g‘ri.',
        en: '❌ Validation failed. Please check your input.',
    },
    RATE_LIMITED: {
        uz: '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.',
        en: '⏳ Too many attempts. Please try again later.',
    },
    INSUFFICIENT_WALLET_BALANCE: {
        uz: "❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.",
        en: '❌ Insufficient balance. Please add funds first.',
    },
    PAYMENTS_DISABLED: {
        uz: '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
        en: '⛔ Payments are currently disabled. Please try again later.',
    },
    PUBLISHER_NOT_FOUND: {
        uz: '❌ Publisher topilmadi. @username yoki t.me link yuboring.',
        en: '❌ Publisher not found. Send a valid @username or t.me link.',
    },
    INVALID_CHANNEL_INPUT: {
        uz: '❌ @username yoki t.me link noto‘g‘ri.',
        en: '❌ Invalid @username or t.me link.',
    },
    REQUEST_FAILED: {
        uz: '❌ Xatolik yuz berdi. Iltimos qayta urinib ko‘ring.',
        en: '❌ Something went wrong. Please try again.',
    },
    REQUEST_TIMEOUT: {
        uz: '⏳ So‘rov vaqti tugadi. Iltimos qayta urinib ko‘ring.',
        en: '⏳ Request timed out. Please try again.',
    },
};

export function resolveErrorUserMessage(
    code: string | null | undefined,
    locale: ErrorUserMessageLocale = 'uz',
): string {
    if (code && ERROR_USER_MESSAGES[code]?.[locale]) {
        return ERROR_USER_MESSAGES[code][locale];
    }
    return ERROR_USER_MESSAGES.REQUEST_FAILED[locale];
}
