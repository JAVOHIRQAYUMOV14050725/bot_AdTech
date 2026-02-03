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

        const expected = this.buildWebhookSignature({
            click_trans_id: String(payload['click_trans_id'] ?? ''),
            service_id: String(payload['service_id'] ?? ''),
            merchant_trans_id: String(payload['merchant_trans_id'] ?? ''),
            amount: String(payload['amount'] ?? ''),
            action: String(payload['action'] ?? ''),
            sign_time: String(payload['sign_time'] ?? ''),
        });
        return expected === signature;
    }

    buildWebhookSignature(params: {
        click_trans_id: string;
        service_id: string;
        merchant_trans_id: string;
        amount: string;
        action: string;
        sign_time: string;
    }) {
        const signString = [
            params.click_trans_id,
            params.service_id,
            this.secretKey,
            params.merchant_trans_id,
            params.amount,
            params.action,
            params.sign_time,
        ]
            .map((value) => String(value ?? ''))
            .join('');

        return createHash('md5').update(signString).digest('hex');
    }
}
