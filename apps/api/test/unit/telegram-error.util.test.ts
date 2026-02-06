import { mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { BackendApiError } from '@/modules/telegram/telegram-backend.client';

describe('mapBackendErrorToTelegramMessage', () => {
    it('maps INVITE_NOT_FOR_YOU to Uzbek message', () => {
        const err = new BackendApiError({
            status: 403,
            code: 'INVITE_NOT_FOR_YOU',
            correlationId: 'corr-1',
            message: 'Invite token does not belong to this Telegram account.',
        });

        expect(mapBackendErrorToTelegramMessage(err)).toBe('❌ Bu taklif sizga tegishli emas.');
    });

    it('falls back to generic safe message for unknown errors with correlation suffix', () => {
        const err = new BackendApiError({
            status: 500,
            code: null,
            correlationId: 'corr-2',
            message: '[object Object]',
        });

        const message = mapBackendErrorToTelegramMessage(err);
        expect(message).not.toBe('[object Object]');
        expect(message).toBe('❌ Xatolik yuz berdi. Iltimos qayta urinib ko‘ring.\n🆔 corr-2');
    });

    it('maps insufficient balance to Uzbek message', () => {
        const err = new BackendApiError({
            status: 400,
            code: 'INSUFFICIENT_WALLET_BALANCE',
            correlationId: 'corr-3',
            message: 'Insufficient wallet balance',
        });

        expect(mapBackendErrorToTelegramMessage(err)).toBe("❌ Balansingiz yetarli emas. Avval 'Add balance' qiling.");
    });
});
