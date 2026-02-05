import { telegramSafeText } from '@/modules/telegram/telegram-safe-text.util';

describe('telegramSafeText', () => {
    it('returns strings as-is', () => {
        expect(telegramSafeText('hello')).toBe('hello');
    });

    it('returns Error messages with fallback', () => {
        expect(telegramSafeText(new Error('boom'))).toBe('boom');
        const error = new Error('');
        expect(telegramSafeText(error)).toBe('Unknown error');
    });

    it('stringifies objects when possible', () => {
        expect(telegramSafeText({ ok: true })).toBe('{"ok":true}');
    });

    it('handles circular objects safely', () => {
        const obj: Record<string, unknown> = {};
        obj.self = obj;
        expect(telegramSafeText(obj)).toBe('Xatolik yuz berdi.');
    });
});
