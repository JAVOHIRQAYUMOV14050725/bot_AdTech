import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

    private get requestTimeoutMs() {
        return this.configService.get<number>('CLICK_TIMEOUT_MS', 15000);
    }

    async createInvoice(params: {
        amount: string;
        merchantTransId: string;
        description: string;
        returnUrl?: string;
        currency?: string;
    }): Promise<ClickInvoiceResponse> {
        const correlationId = RequestContext.getCorrelationId();
        const { baseUrl, path, url, timeoutMs } = this.ensureValidConfig(
            this.createInvoicePath,
            'create_invoice',
        );

        this.logger.log(
            {
                event: 'click_http_request',
                correlationId,
                data: {
                    method: 'POST',
                    url,
                    baseUrl,
                    path,
                    timeoutMs,
                },
            },
            'ClickPaymentService',
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
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
                signal: controller.signal,
            });

            const rawBody = await response.text();
            const contentType = response.headers.get('content-type');
            const isJson = Boolean(contentType && contentType.includes('application/json'));
            const parsedBody = isJson ? this.parseJsonSafe(rawBody) : rawBody;
            const safeHeaders = this.sanitizeClickPayload(
                Object.fromEntries(response.headers.entries()),
            );
            const bodyPreview = this.safeText(this.extractRawSnippet(rawBody));
            const sanitizedBody = isJson
                ? this.sanitizeClickPayload(parsedBody)
                : this.safeText(rawBody);

            this.logger.log(
                {
                    event: 'click_invoice_response_raw',
                    correlationId,
                    data: {
                        status: response.status,
                        headers: safeHeaders,
                        bodyPreview,
                        body: sanitizedBody,
                    },
                },
                'ClickPaymentService',
            );

            if (this.isHtml(rawBody)) {
                this.logInvoiceFailure({
                    correlationId,
                    url,
                    status: response.status,
                    errorCode: this.extractErrorCode(parsedBody),
                    errorBodyPreview: bodyPreview,
                });
                throw new ServiceUnavailableException({
                    message: 'Click invoice failed: HTML response',
                    code: 'CLICK_INVOICE_FAILED',
                    correlationId,
                    details: {
                        url,
                        status: response.status,
                        errorCode: this.extractErrorCode(parsedBody),
                        errorBodyPreview: bodyPreview,
                    },
                });
            }

            if (!response.ok) {
                this.logInvoiceFailure({
                    correlationId,
                    url,
                    status: response.status,
                    errorCode: this.extractErrorCode(parsedBody),
                    errorBodyPreview: bodyPreview,
                });
                throw new ServiceUnavailableException({
                    message: 'Click invoice failed',
                    code: 'CLICK_INVOICE_FAILED',
                    correlationId,
                    details: {
                        url,
                        status: response.status,
                        errorCode: this.extractErrorCode(parsedBody),
                        errorBodyPreview: bodyPreview,
                    },
                });
            }

            return this.extractInvoiceResponse(parsedBody, rawBody);
        } catch (err) {
            if ((err as { name?: string }).name === 'AbortError') {
                this.logInvoiceFailure({
                    correlationId,
                    url,
                    status: null,
                    errorCode: 'REQUEST_TIMEOUT',
                    errorBodyPreview: `Timed out after ${timeoutMs}ms`,
                });
                throw new ServiceUnavailableException({
                    message: `Click invoice request timed out after ${timeoutMs}ms`,
                    code: 'CLICK_INVOICE_FAILED',
                    correlationId,
                    details: {
                        url,
                        status: null,
                        errorCode: 'REQUEST_TIMEOUT',
                        errorBodyPreview: `Timed out after ${timeoutMs}ms`,
                    },
                });
            }

            if (err instanceof ServiceUnavailableException) {
                throw err;
            }

            const errorMessage = err instanceof Error ? err.message : String(err);
            this.logInvoiceFailure({
                correlationId,
                url,
                status: null,
                errorCode: 'REQUEST_FAILED',
                errorBodyPreview: this.safeText(errorMessage),
            });
            throw new ServiceUnavailableException({
                message: 'Click invoice request failed',
                code: 'CLICK_INVOICE_FAILED',
                correlationId,
                details: {
                    url,
                    status: null,
                    errorCode: 'REQUEST_FAILED',
                    errorBodyPreview: this.safeText(errorMessage),
                },
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async getInvoiceStatus(params: { merchantTransId: string }) {
        const { url, timeoutMs } = this.ensureValidConfig(
            this.invoiceStatusPath,
            'invoice_status',
        );
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

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

    private parseUrlSafe(value: string): URL | null {
        try {
            return new URL(value);
        } catch {
            return null;
        }
    }

    private ensureValidConfig(
        path: string,
        mode: 'create_invoice' | 'invoice_status',
    ): { baseUrl: string; path: string; url: string; timeoutMs: number } {
        const correlationId = RequestContext.getCorrelationId();
        const baseUrl = this.baseUrl;
        const normalizedPath = path ?? '';
        const url = this.buildUrl(normalizedPath);
        const errors: string[] = [];

        const parsedBase = this.parseUrlSafe(baseUrl);
        if (!parsedBase) {
            errors.push('base_url_invalid');
        } else {
            if (this.isLocalHost(parsedBase.hostname)) {
                errors.push('base_url_localhost');
            }
            if (!this.isAllowedClickHost(parsedBase.hostname)) {
                errors.push('base_url_unexpected_host');
            }
        }

        if (!normalizedPath.startsWith('/')) {
            errors.push('path_missing_leading_slash');
        }
        if (normalizedPath === '/payment/create') {
            errors.push('path_disallowed_payment_create');
        }

        if (!this.parseUrlSafe(url)) {
            errors.push('resolved_url_invalid');
        }

        if (errors.length > 0) {
            const details = {
                mode,
                baseUrl,
                path: normalizedPath,
                url,
                hostname: parsedBase?.hostname ?? null,
                reason: errors,
            };
            this.logger.warn(
                {
                    event: 'click_config_invalid',
                    correlationId,
                    data: details,
                },
                'ClickPaymentService',
            );
            throw new ServiceUnavailableException({
                message: 'Click config invalid',
                code: 'CLICK_CONFIG_INVALID',
                correlationId,
                details,
            });
        }

        return {
            baseUrl,
            path: normalizedPath,
            url,
            timeoutMs: this.requestTimeoutMs,
        };
    }

    private isLocalHost(hostname: string): boolean {
        const normalized = hostname.toLowerCase();
        if (normalized === 'localhost' || normalized === '0.0.0.0') {
            return true;
        }
        if (normalized === '[::1]') {
            return true;
        }
        return normalized.startsWith('127.');
    }

    private isAllowedClickHost(hostname: string): boolean {
        const normalized = hostname.toLowerCase();
        if (normalized.includes('click')) {
            return true;
        }
        return normalized.endsWith('.click.uz') || normalized === 'click.uz';
    }

    private logInvoiceFailure(params: {
        correlationId: string | undefined;
        url: string;
        status: number | null;
        errorCode: string | number | null;
        errorBodyPreview: string;
    }) {
        this.logger.error(
            {
                event: 'click_invoice_create_failed',
                correlationId: params.correlationId,
                data: {
                    url: params.url,
                    status: params.status,
                    errorCode: params.errorCode ?? null,
                    errorBodyPreview: params.errorBodyPreview,
                },
            },
            'ClickPaymentService',
        );
    }

    private extractErrorCode(payload: unknown): string | number | null {
        if (!payload || typeof payload !== 'object') {
            return null;
        }
        const record = payload as Record<string, unknown>;
        const data = record.data as Record<string, unknown> | undefined;
        const candidates = [
            record.error_code,
            record.errorCode,
            record.error,
            data?.error_code,
            data?.errorCode,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' || typeof candidate === 'number') {
                return candidate;
            }
        }
        return null;
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