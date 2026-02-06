import { hasTelegramReplyBeenSent, replySafe, telegramUserMessage } from '@/modules/telegram/telegram-safe-text.util';

describe('telegramUserMessage', () => {
    it('does not return [object Object] for plain objects', () => {
        const result = telegramUserMessage({}, 'uz');

        expect(result).not.toBe('[object Object]');
        expect(result).toBe('❌ Xatolik yuz berdi. Iltimos qayta urinib ko‘ring.');
    });

    it('does not return [object Object] for Error with object message', () => {
        const err = new Error({} as any);
        const result = telegramUserMessage(err, 'uz');

        expect(result).not.toBe('[object Object]');
        expect(typeof result).toBe('string');
    });

    it('returns English fallback when locale is en', () => {
        const result = telegramUserMessage(null, 'en');

        expect(result).toBe('❌ Something went wrong. Please try again.');
    });

    it('never returns [object Object] for any input', () => {
        const inputs: unknown[] = [
            '[object Object]',
            {},
            new Error('[object Object]'),
            { message: '[object Object]' },
            { userMessage: '[object Object]' },
            null,
            undefined,
            [],
        ];

        for (const input of inputs) {
            const result = telegramUserMessage(input, 'uz');
            expect(result).not.toBe('[object Object]');
        }
    });

    it('marks replies as sent even when ctx.state is missing', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);
        const ctx = {
            reply,
            from: { language_code: 'uz' },
        } as any;

        await replySafe(ctx, 'OK');

        expect(reply).toHaveBeenCalledWith('OK', undefined);
        expect(hasTelegramReplyBeenSent(ctx)).toBe(true);
    });
});
