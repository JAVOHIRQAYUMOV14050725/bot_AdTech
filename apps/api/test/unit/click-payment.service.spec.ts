import { createHash } from 'crypto';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';

describe('ClickPaymentService', () => {
    const makeService = () => {
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
        return new ClickPaymentService(configService);
    };

    it('builds invoice signature in required order', () => {
        const service = makeService();
        const signature = service.buildCreateInvoiceSignature({
            service_id: 's1',
            merchant_id: 'm1',
            user_id: 'u1',
            merchant_trans_id: 'txn-1',
            amount: '1000',
            timestamp: '1700000000',
        });

        const expected = createHash('md5')
            .update('s1m1u1txn-110001700000000sec')
            .digest('hex');
        expect(signature).toBe(expected);
    });

    it('sends signed invoice create payload', async () => {
        const service = makeService();
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: {
                get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
                entries: () => [['content-type', 'application/json']][Symbol.iterator](),
            },
            text: jest.fn().mockResolvedValue(JSON.stringify({ invoice_id: 'inv-1', payment_url: 'https://click/pay/1' })),
        });
        (global as any).fetch = fetchMock;

        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000 * 1000);
        await service.createInvoice({
            amount: '10.00',
            merchantTransId: 't-1',
            description: 'test',
            returnUrl: 'https://example.com/api/payments/click/return',
            phoneNumber: '998901112233',
        });

        const options = fetchMock.mock.calls[0][1];
        const body = JSON.parse(options.body as string);
        const expectedSign = createHash('md5').update('s1m1u1t-110.001700000000sec').digest('hex');
        expect(body.phone).toBe('998901112233');
        expect(body.timestamp).toBe('1700000000');
        expect(body.sign).toBe(expectedSign);
        expect(options.headers['X-CLICK-SIGN']).toBe(expectedSign);
        nowSpy.mockRestore();
    });

    it('maps provider error_code -406 to configuration message', async () => {
        const service = makeService();
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

        await expect(service.createInvoice({
            amount: '10.00',
            merchantTransId: 't1',
            description: 'test',
            phoneNumber: '998901112233',
            returnUrl: 'https://example.com/api/payments/click/return',
        }))
            .rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'CLICK_INVOICE_FAILED',
                    userMessage: expect.stringContaining('configuration error'),
                }),
            });
    });
});