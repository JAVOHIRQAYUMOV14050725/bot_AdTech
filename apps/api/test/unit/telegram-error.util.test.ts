import { mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { BackendApiError } from '@/modules/telegram/telegram-backend.client';

describe('mapBackendErrorToTelegramMessage', () => {
    it('maps known backend codes to Uzbek messages', () => {
        const cases = [
            ['INVITE_NOT_FOR_YOU', '❌ Bu taklif sizga tegishli emas.'],
            ['USER_MUST_START_BOT_FIRST', '❌ Avval botga /start bosing, so‘ng taklif yuboriladi.'],
            ['PUBLISHER_NOT_REGISTERED', '❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.'],
            ['CHANNEL_NOT_APPROVED', '⏳ Kanal hali marketplace’da tasdiqlanmagan. Admin ko‘rib chiqmoqda.'],
            ['CHANNEL_NOT_OWNED_BY_PUBLISHER', '❌ Kanal egasi publisher akkaunt emas.'],
            ['INVALID_TELEGRAM_INTERNAL_TOKEN', '❌ Xavfsizlik tekshiruvi o‘tmadi.'],
            ['UNAUTHORIZED', '❌ Xavfsizlik tekshiruvi o‘tmadi.'],
            ['VALIDATION_FAILED', '❌ Kiritilgan ma’lumot noto‘g‘ri.'],
            ['RATE_LIMITED', '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.'],
        ] as const;

        for (const [code, expected] of cases) {
            const err = new BackendApiError({
                status: 400,
                code,
                correlationId: 'corr-abc',
                message: 'nope',
            });
            expect(mapBackendErrorToTelegramMessage(err)).toBe(expected);
        }
    });

    it('uses generic fallback with correlation id for unknown codes', () => {
        const err = new BackendApiError({
            status: 500,
            code: 'SOME_UNKNOWN',
            correlationId: 'corr-999',
            message: 'oops',
        });
        expect(mapBackendErrorToTelegramMessage(err)).toBe('❌ Xatolik yuz berdi. (ID: corr-999)');
    });
});
