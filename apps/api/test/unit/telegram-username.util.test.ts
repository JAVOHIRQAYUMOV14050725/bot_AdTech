import { normalizeTelegramIdentifierInput, normalizeTelegramUsername, parseTelegramIdentifier } from '@/common/utils/telegram-username.util';

describe('normalizeTelegramUsername', () => {
    it('normalizes @Name and name to same value', () => {
        expect(normalizeTelegramUsername('@Name')).toBe('name');
        expect(normalizeTelegramUsername('name')).toBe('name');
    });

    it('normalizes t.me links', () => {
        expect(normalizeTelegramUsername('https://t.me/Name')).toBe('name');
        expect(normalizeTelegramUsername('t.me/Name')).toBe('name');
    });

    it('parses identifiers with @, casing, and links', () => {
        expect(parseTelegramIdentifier('@Javohir_Qayumov').normalized).toBe('javohir_qayumov');
        expect(parseTelegramIdentifier('javohir_qayumov').normalized).toBe('javohir_qayumov');
        expect(parseTelegramIdentifier('t.me/Javohir_Qayumov').normalized).toBe('javohir_qayumov');
    });

    it('normalizes canonical identifiers for publisher input', () => {
        expect(normalizeTelegramIdentifierInput('@wwwcomuzru').canonical).toBe('@wwwcomuzru');
        expect(normalizeTelegramIdentifierInput('t.me/wwwcomuzru').canonical).toBe('@wwwcomuzru');
        expect(normalizeTelegramIdentifierInput('   t.me/wwwcomuzru   ').canonical).toBe('@wwwcomuzru');
        expect(normalizeTelegramIdentifierInput('garbage input').canonical).toBeNull();
    });
});
