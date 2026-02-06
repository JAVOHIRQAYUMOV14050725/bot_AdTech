import { telegramUserMessage } from '@/modules/telegram/telegram-safe-text.util';

describe('telegramUserMessage', () => {
    it('never returns [object Object] for unknown inputs', () => {
        const inputs = [
            {},
            { message: {} },
            { error: { message: { detail: 'Nested' } } },
            ['ok', {}],
            null,
            undefined,
            '[object Object]',
            new Error(''),
        ];

        for (const input of inputs) {
            const message = telegramUserMessage(input, 'uz');
            expect(message).toBeTruthy();
            expect(message).not.toBe('[object Object]');
        }
    });
});
