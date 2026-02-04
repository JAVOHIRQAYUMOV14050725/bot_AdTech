import { normalizeTelegramUsername } from '@/common/utils/telegram-username.util';

describe('normalizeTelegramUsername', () => {
    it('normalizes @Name and name to same value', () => {
        expect(normalizeTelegramUsername('@Name')).toBe('name');
        expect(normalizeTelegramUsername('name')).toBe('name');
    });

    it('normalizes t.me links', () => {
        expect(normalizeTelegramUsername('https://t.me/Name')).toBe('name');
        expect(normalizeTelegramUsername('t.me/Name')).toBe('name');
    });
});