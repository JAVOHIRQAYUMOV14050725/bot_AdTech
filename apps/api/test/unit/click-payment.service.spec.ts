import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';

describe('ClickPaymentService invoice parsing', () => {
    const service = new ClickPaymentService({ get: jest.fn() } as never);

    it('extracts invoice fields from top-level response', () => {
        const payload = { invoice_id: 'inv-1', payment_url: 'https://click/pay/1' };
        const result = (service as never as { extractInvoiceResponse: (p: unknown, r: string) => unknown })
            .extractInvoiceResponse(payload, JSON.stringify(payload)) as { invoice_id: string; payment_url: string };
        expect(result).toEqual({ invoice_id: 'inv-1', payment_url: 'https://click/pay/1' });
    });

    it('extracts invoice fields from nested data payload', () => {
        const payload = { data: { invoice_id: 'inv-2', payment_url: 'https://click/pay/2' } };
        const result = (service as never as { extractInvoiceResponse: (p: unknown, r: string) => unknown })
            .extractInvoiceResponse(payload, JSON.stringify(payload)) as { invoice_id: string; payment_url: string };
        expect(result).toEqual({ invoice_id: 'inv-2', payment_url: 'https://click/pay/2' });
    });

    it('extracts invoice fields from nested invoice payload', () => {
        const payload = { result: { invoice: { invoice_id: 'inv-3', payment_url: 'https://click/pay/3' } } };
        const result = (service as never as { extractInvoiceResponse: (p: unknown, r: string) => unknown })
            .extractInvoiceResponse(payload, JSON.stringify(payload)) as { invoice_id: string; payment_url: string };
        expect(result).toEqual({ invoice_id: 'inv-3', payment_url: 'https://click/pay/3' });
    });

    it('throws when invoice fields are missing', () => {
        const payload = { status: 'ok' };
        expect(() =>
            (service as never as { extractInvoiceResponse: (p: unknown, r: string) => unknown })
                .extractInvoiceResponse(payload, JSON.stringify(payload)),
        ).toThrow('Click invoice response missing invoice_id/payment_url');
    });
});
