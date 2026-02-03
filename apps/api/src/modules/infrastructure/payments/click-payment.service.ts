import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

type ClickInvoiceResponse = {
    invoice_id: string;
    payment_url: string;
};

type ClickStatusResponse = {
    invoice_id: string;
    status: string;
    click_trans_id?: string;
};

@Injectable()
export class ClickPaymentService {
    constructor(private readonly configService: ConfigService) { }

    private get baseUrl() {
        return this.configService.get<string>(
            'CLICK_API_BASE_URL',
            'https://api.click.uz',
        );
    }

    private get serviceId() {
        return this.configService.get<string>('CLICK_SERVICE_ID', '');
    }

    private get merchantId() {
        return this.configService.get<string>('CLICK_MERCHANT_ID', '');
    }

    private get secretKey() {
        return this.configService.get<string>('CLICK_SECRET_KEY', '');
    }

    async createInvoice(params: {
        amount: string;
        merchantTransId: string;
        description: string;
        returnUrl?: string;
        currency?: string;
    }): Promise<ClickInvoiceResponse> {
        const response = await fetch(`${this.baseUrl}/payment/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                service_id: this.serviceId,
                merchant_id: this.merchantId,
                amount: params.amount,
                merchant_trans_id: params.merchantTransId,
                description: params.description,
                return_url: params.returnUrl,
                currency: params.currency ?? 'USD',
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Click invoice failed: ${response.status} ${text}`);
        }

        return (await response.json()) as ClickInvoiceResponse;
    }

    async getInvoiceStatus(params: { merchantTransId: string }) {
        const response = await fetch(`${this.baseUrl}/payment/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                service_id: this.serviceId,
                merchant_id: this.merchantId,
                merchant_trans_id: params.merchantTransId,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Click status failed: ${response.status} ${text}`);
        }

        return (await response.json()) as ClickStatusResponse;
    }

    verifyWebhookSignature(payload: Record<string, string | number | null>) {
        const signature = String(payload['sign'] ?? '');
        if (!signature) {
            return false;
        }

        const signString = [
            payload['click_trans_id'],
            payload['service_id'],
            this.secretKey,
            payload['merchant_trans_id'],
            payload['amount'],
            payload['action'],
            payload['sign_time'],
        ]
            .map((value) => String(value ?? ''))
            .join('');

        const expected = createHash('md5').update(signString).digest('hex');
        return expected === signature;
    }
}
