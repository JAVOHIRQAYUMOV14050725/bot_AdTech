import { ConfigService } from '@nestjs/config';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';

describe('Click webhook signature', () => {
    it('rejects invalid signatures', () => {
        const configService = new ConfigService({
            CLICK_SECRET_KEY: 'secret',
        });
        const service = new ClickPaymentService(configService);

        const payload = {
            click_trans_id: '1',
            service_id: 'service',
            merchant_trans_id: 'intent',
            amount: '10.00',
            action: '1',
            sign_time: '123456',
            sign: 'bad',
        };

        expect(service.verifyWebhookSignature(payload)).toBe(false);
    });

    it('accepts valid signatures', () => {
        const configService = new ConfigService({
            CLICK_SECRET_KEY: 'secret',
        });
        const service = new ClickPaymentService(configService);

        const sign = service.buildWebhookSignature({
            click_trans_id: '1',
            service_id: 'service',
            merchant_trans_id: 'intent',
            amount: '10.00',
            action: '1',
            sign_time: '123456',
        });

        const payload = {
            click_trans_id: '1',
            service_id: 'service',
            merchant_trans_id: 'intent',
            amount: '10.00',
            action: '1',
            sign_time: '123456',
            sign,
        };

        expect(service.verifyWebhookSignature(payload)).toBe(true);
    });
});