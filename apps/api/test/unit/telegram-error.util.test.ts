import { telegramSafeErrorMessage } from '@/modules/telegram/telegram-error.util';

describe('telegramSafeErrorMessage', () => {
    it('returns string errors as-is', () => {
        expect(telegramSafeErrorMessage('bad')).toBe('bad');
    });

    it('returns Error messages', () => {
        expect(telegramSafeErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('handles HttpException-like responses', () => {
        const err = {
            getResponse: () => ({ message: ['first', 'second'] }),
        };
        expect(telegramSafeErrorMessage(err)).toBe('first; second');
    });

    it('handles axios-style error responses', () => {
        const err = {
            response: {
                data: { message: 'axios fail' },
                status: 400,
                statusText: 'Bad Request',
            },
        };
        expect(telegramSafeErrorMessage(err)).toBe('axios fail');
    });

    it('handles nested message arrays', () => {
        const err = { message: ['one', { message: 'two' }] };
        expect(telegramSafeErrorMessage(err)).toBe('one; two');
    });

    it('never returns [object Object]', () => {
        const err = { foo: 'bar' };
        expect(telegramSafeErrorMessage(err)).not.toBe('[object Object]');
        expect(telegramSafeErrorMessage(err)).toBe('Unexpected error');
    });
});
