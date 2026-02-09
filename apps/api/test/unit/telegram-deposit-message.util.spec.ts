import { formatDepositIntentMessage } from '@/modules/telegram/telegram-deposit-message.util';

describe('formatDepositIntentMessage', () => {
    it('returns payment link message when URL exists', () => {
        const result = formatDepositIntentMessage({
            amount: '12.50',
            paymentUrl: 'https://click/pay/abc',
            correlationId: 'corr-1',
        });

        expect(result.hasPaymentUrl).toBe(true);
        expect(result.message).toContain('https://click/pay/abc');
    });

    it('returns fallback message when URL is missing', () => {
        const result = formatDepositIntentMessage({
            amount: '12.50',
            paymentUrl: null,
            correlationId: 'corr-2',
        });

        expect(result.hasPaymentUrl).toBe(false);
        expect(result.message).toContain('corr-2');
    });

    it('returns fallback message when URL is pending', () => {
        const result = formatDepositIntentMessage({
            amount: '12.50',
            paymentUrl: 'pending',
            correlationId: 'corr-3',
        });

        expect(result.hasPaymentUrl).toBe(false);
        expect(result.message).toContain('corr-3');
        expect(result.message).not.toContain('pending');
    });
});
