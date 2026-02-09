import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RequestContext } from '@/common/context/request-context';

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

    private get createInvoicePath() {
        return this.configService.get<string>(
            'CLICK_CREATE_INVOICE_PATH',
            '/v2/merchant/invoice/create',
        );
    }

    private get invoiceStatusPath() {
        return this.configService.get<string>(
            'CLICK_GET_INVOICE_STATUS_PATH',
            '/payment/status',
        );
    }

    async createInvoice(params: {
        amount: string;
        merchantTransId: string;
        description: string;
        returnUrl?: string;
        currency?: string;
    }): Promise<ClickInvoiceResponse> {
        const correlationId = RequestContext.getCorrelationId();
        const url = this.buildUrl(this.createInvoicePath);

        this.logger.log(
            {
                event: 'click_http_request',
                method: 'POST',
                url,
                correlationId,
            },
            'ClickPaymentService',
        );

        const response = await fetch(url, {
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
        const extracted = this.extractInvoiceFields(parsedBody);
        this.logger.log(
            {
                event: 'click_invoice_response_raw',
                statusCode: response.status,
                ok: response.ok,
                correlationId,
                topLevelKeys: this.extractTopLevelKeys(parsedBody),
                invoiceId: extracted.invoiceId ?? null,
                paymentUrlLength: extracted.paymentUrl ? extracted.paymentUrl.length : 0,
                paymentUrlPreview: extracted.paymentUrl
                    ? this.redactUrlPreview(extracted.paymentUrl)
                    : null,
            },
            'ClickPaymentService',
        );

        if (!response.ok) {
            throw new Error(
                `Click invoice failed: ${response.status} ${this.safeText(this.extractRawSnippet(rawBody))}`,
            );
        }

        return this.extractInvoiceResponse(parsedBody, rawBody);
    }

    async getInvoiceStatus(params: { merchantTransId: string }) {
        const url = this.buildUrl(this.invoiceStatusPath);
        const response = await fetch(url, {
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

    private extractInvoiceResponse(payload: unknown, rawBody: string): ClickInvoiceResponse {
        const candidates = this.flattenCandidates(payload);

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') {
                continue;
            }
            const record = candidate as Record<string, unknown>;
            const invoiceId = this.readFirstString(record, [
                ['invoice_id'],
                ['invoiceId'],
                ['id'],
                ['invoice', 'invoiceId'],
            ]);
            const paymentUrl = this.readFirstString(record, [
                ['payment_url'],
                ['paymentUrl'],
                ['url'],
                ['payment', 'payment_url'],
                ['payment', 'paymentUrl'],
            ]);

            if (invoiceId || paymentUrl) {
                return {
                    invoice_id: invoiceId ?? '',
                    payment_url: paymentUrl ?? '',
                };
            }
        }

        const snippet = this.safeText(this.extractRawSnippet(rawBody));
        throw new Error(
            `Click invoice response missing invoice_id/payment_url. Raw snippet: ${snippet}`,
        );
    }

    private extractInvoiceFields(payload: unknown): {
        invoiceId?: string;
        paymentUrl?: string;
    } {
        const candidates = this.flattenCandidates(payload);

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') {
                continue;
            }
            const record = candidate as Record<string, unknown>;
            const invoiceId = this.readFirstString(record, [
                ['invoice_id'],
                ['invoiceId'],
                ['id'],
                ['invoice', 'invoiceId'],
            ]);
            const paymentUrl = this.readFirstString(record, [
                ['payment_url'],
                ['paymentUrl'],
                ['url'],
                ['payment', 'payment_url'],
                ['payment', 'paymentUrl'],
            ]);

            if (invoiceId || paymentUrl) {
                return { invoiceId: invoiceId ?? undefined, paymentUrl: paymentUrl ?? undefined };
            }
        }

        return {};
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

    private extractTopLevelKeys(payload: unknown): string[] {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return [];
        }
        return Object.keys(payload as Record<string, unknown>);
    }

    private readFirstString(
        record: Record<string, unknown>,
        keyPaths: string[][],
    ): string | null {
        for (const path of keyPaths) {
            const value = this.readString(record, path);
            if (value !== null) {
                return value;
            }
        }
        return null;
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

    private buildUrl(path: string) {
        const base = this.baseUrl.replace(/\/+$/, '');
        const normalizedPath = path ? `/${path.replace(/^\/+/, '')}` : '';
        return `${base}${normalizedPath}`;
    }

    private extractRawSnippet(rawBody: string): string {
        if (!rawBody) {
            return '';
        }
        if (this.isHtml(rawBody)) {
            return rawBody.replace(/\s+/g, ' ').slice(0, 200);
        }
        return rawBody;
    }

    private isHtml(rawBody: string): boolean {
        return /<!doctype html|<html/i.test(rawBody);
    }

    private redactUrlPreview(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }
        const preview = trimmed.slice(0, 12);
        return preview.length < trimmed.length ? `${preview}…` : preview;
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