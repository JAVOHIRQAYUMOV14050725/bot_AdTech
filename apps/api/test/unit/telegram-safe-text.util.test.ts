import { telegramSafeText } from '@/modules/telegram/telegram-safe-text.util';

describe('telegramSafeText', () => {
    it('does not return [object Object] for plain objects', () => {
        const result = telegramSafeText({});

        expect(result).not.toBe('[object Object]');
        expect(result).toBe('Xatolik yuz berdi.');
    });

    it('does not return [object Object] for Error with object message', () => {
        const err = new Error({} as any);
        const result = telegramSafeText(err);

        expect(result).not.toBe('[object Object]');
        expect(typeof result).toBe('string');
    });

    it('returns fallback for circular objects', () => {
        const value: { self?: unknown } = {};
        value.self = value;

        const result = telegramSafeText(value);

        expect(result).toBe('Xatolik yuz berdi.');
    });
});
