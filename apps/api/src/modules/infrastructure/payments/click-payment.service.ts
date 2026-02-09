import { Injectable, Logger } from '@nestjs/common';
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
    private readonly logger = new Logger(ClickPaymentService.name);

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

        const rawBody = await response.text();
        const parsedBody = this.parseJsonSafe(rawBody);
        this.logger.log(
            {
                event: 'click_invoice_response',
                status: response.status,
                ok: response.ok,
                payload: this.sanitizeClickPayload(parsedBody),
            },
            'ClickPaymentService',
        );

        if (!response.ok) {
            throw new Error(`Click invoice failed: ${response.status} ${this.safeText(rawBody)}`);
        }

        return this.normalizeInvoiceResponse(parsedBody);
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

    private parseJsonSafe(raw: string): unknown {
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }

    private normalizeInvoiceResponse(payload: unknown): ClickInvoiceResponse {
        const candidates = this.flattenCandidates(payload);

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') {
                continue;
            }
            const record = candidate as Record<string, unknown>;
            const invoiceId =
                this.readString(record, ['invoice_id', 'invoiceId', 'id']) ??
                this.readString(record, ['invoice', 'invoiceId']);
            const paymentUrl =
                this.readString(record, ['payment_url', 'paymentUrl', 'url']) ??
                this.readString(record, ['payment', 'payment_url', 'paymentUrl']);

            if (invoiceId || paymentUrl) {
                return {
                    invoice_id: invoiceId ?? '',
                    payment_url: paymentUrl ?? '',
                };
            }
        }

        return {
            invoice_id: '',
            payment_url: '',
        };
    }

    private flattenCandidates(payload: unknown): Array<Record<string, unknown> | unknown> {
        if (!payload || typeof payload !== 'object') {
            return [payload];
        }
        const record = payload as Record<string, unknown>;
        return [
            record,
            record.data,
            record.result,
            record.response,
            record.invoice,
            record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>).invoice : null,
            record.result && typeof record.result === 'object' ? (record.result as Record<string, unknown>).invoice : null,
            record.response && typeof record.response === 'object'
                ? (record.response as Record<string, unknown>).invoice
                : null,
        ];
    }

    private readString(record: Record<string, unknown>, keys: string[]): string | null {
        let current: unknown = record;
        for (const key of keys) {
            if (!current || typeof current !== 'object') {
                return null;
            }
            current = (current as Record<string, unknown>)[key];
        }
        if (typeof current === 'string') {
            return current;
        }
        if (typeof current === 'number') {
            return String(current);
        }
        return null;
    }

    private sanitizeClickPayload(payload: unknown): unknown {
        if (payload === null || payload === undefined) {
            return payload;
        }
        if (typeof payload !== 'object') {
            return this.safeText(String(payload));
        }
        if (Array.isArray(payload)) {
            return payload.map((value) => this.sanitizeClickPayload(value));
        }

        const record = payload as Record<string, unknown>;
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
            sanitized[key] = this.sanitizeValue(key, value);
        }
        return sanitized;
    }

    private sanitizeValue(key: string, value: unknown): unknown {
        if (value === null || value === undefined) {
            return value;
        }
        const normalizedKey = key.toLowerCase();
        const sensitiveKeys = ['token', 'secret', 'sign', 'key', 'merchant', 'password'];
        if (sensitiveKeys.some((sensitive) => normalizedKey.includes(sensitive))) {
            return '[redacted]';
        }
        if (normalizedKey.includes('payment_url') || normalizedKey.includes('paymenturl')) {
            return this.stripUrlQuery(String(value));
        }
        if (typeof value === 'object') {
            return this.sanitizeClickPayload(value);
        }
        if (typeof value === 'string') {
            return this.safeText(value);
        }
        return value;
    }

    private stripUrlQuery(value: string): string {
        try {
            const parsed = new URL(value);
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return this.safeText(value);
        }
    }

    private safeText(value: string): string {
        if (value.length > 200) {
            return `${value.slice(0, 200)}…`;
        }
        return value;
    }
}