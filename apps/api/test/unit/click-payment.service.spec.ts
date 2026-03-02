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

    it('requires phone and sends it in create invoice payload', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: {
                get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
                entries: () => [['content-type', 'application/json']][Symbol.iterator](),
            },
            text: jest.fn().mockResolvedValue(JSON.stringify({ invoice_id: 'inv-77', payment_url: 'https://click/pay/77' })),
        });
        (global as any).fetch = fetchMock;

        const configService = {
            get: (key: string, fallback?: string) => {
                const values: Record<string, string> = {
                    CLICK_API_BASE_URL: 'https://api.click.uz',
                    CLICK_CREATE_INVOICE_PATH: '/v2/merchant/invoice/create',
                    CLICK_MERCHANT_ID: 'm1',
                    CLICK_SERVICE_ID: 's1',
                    CLICK_USER_ID: 'u1',
                    CLICK_SECRET_KEY: 'sec',
                };
                return values[key] ?? fallback ?? '';
            },
        } as never;

        const service = new ClickPaymentService(configService);

        await expect(service.createInvoice({ amount: '10.00', merchantTransId: 't1', description: 'test', returnUrl: 'https://example.com/api/payments/click/return' }))
            .rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'PHONE_REQUIRED',
                }),
            });

        await service.createInvoice({ amount: '10.00', merchantTransId: 't2', description: 'test', phoneNumber: '998901112233', returnUrl: 'https://example.com/api/payments/click/return' });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.phone).toBe('998901112233');
        expect(body.return_url).toBe('https://example.com/api/payments/click/return');
    });

});

describe('ClickPaymentService diagnostics', () => {
    it('returns clear CLICK_INVOICE_FAILED for provider error_code and logs it', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: {
                get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
                entries: () => [['content-type', 'application/json']][Symbol.iterator](),
            },
            text: jest.fn().mockResolvedValue(JSON.stringify({ error_code: -406, message: 'invalid user' })),
        });
        (global as any).fetch = fetchMock;

        const configService = {
            get: (key: string, fallback?: string) => {
                const values: Record<string, string> = {
                    CLICK_API_BASE_URL: 'https://api.click.uz',
                    CLICK_CREATE_INVOICE_PATH: '/v2/merchant/invoice/create',
                    CLICK_MERCHANT_ID: 'm1',
                    CLICK_SERVICE_ID: 's1',
                    CLICK_USER_ID: 'u1',
                    CLICK_SECRET_KEY: 'sec',
                };
                return values[key] ?? fallback ?? '';
            },
        } as never;

        const service = new ClickPaymentService(configService);
        const errorSpy = jest.spyOn((service as never as { logger: { error: (...args: unknown[]) => void } }).logger, 'error');

        await expect(service.createInvoice({ amount: '10.00', merchantTransId: 't1', description: 'test', phoneNumber: '998901112233', returnUrl: 'https://example.com/api/payments/click/return' }))
            .rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'CLICK_INVOICE_FAILED',
                    userMessage: expect.stringContaining('-406'),
                }),
            });

        expect(errorSpy).toHaveBeenCalled();
    });
});
