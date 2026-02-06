import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import { TelegramResolvePublisherResult } from './telegram.types';
import { AsyncLocalStorage } from 'async_hooks';

type BackendErrorPayload = {
    message: string;
    code: string | null;
    userMessage: string | null;
    correlationId: string;
    raw?: unknown;
};

type ParsedBackendErrorShape = {
    message?: unknown;
    code?: unknown;
    correlationId?: unknown;
    userMessage?: unknown;
    statusCode?: unknown;
    error?: { message?: unknown; details?: { code?: unknown; userMessage?: unknown; message?: unknown } };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeJsonStringify = (value: unknown): string | null => {
    const seen = new WeakSet<object>();
    let hasCircular = false;
    try {
        const serialized = JSON.stringify(value, (_, nextValue) => {
            if (nextValue && typeof nextValue === 'object') {
                if (seen.has(nextValue)) {
                    hasCircular = true;
                    return undefined;
                }
                seen.add(nextValue);
            }
            return nextValue;
        });
        if (hasCircular) {
            return null;
        }
        return serialized ?? null;
    } catch {
        return null;
    }
};

export const toErrorMessage = (value: unknown, fallback: string): string => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => toErrorMessage(entry, ''))
            .filter((entry) => entry);
        if (parts.length) {
            return parts.join('; ');
        }
        return fallback;
    }

    if (isRecord(value)) {
        const nestedMessage = value.message ?? (value.error as { message?: unknown } | undefined)?.message;
        if (typeof nestedMessage !== 'undefined') {
            const extracted = toErrorMessage(nestedMessage, '');
            if (extracted) {
                return extracted;
            }
        }
        const serialized = safeJsonStringify(value);
        if (serialized && serialized !== '{}' && serialized !== '[object Object]') {
            return serialized;
        }
        return fallback;
    }

    const coerced = String(value ?? '').trim();
    return coerced || fallback;
};

export class BackendApiError extends Error {
    status: number;
    code: string | null;
    correlationId: string | null;
    httpStatus: number;
    userMessage: string | null;
    raw?: unknown;

    constructor(params: {
        status: number;
        code?: string | null;
        correlationId: string | null;
        message: string;
        userMessage?: string | null;
        raw?: unknown;
    }) {
        super(params.message);
        this.name = 'BackendApiError';
        this.status = params.status;
        this.httpStatus = params.status;
        this.code = params.code ?? null;
        this.correlationId = params.correlationId ?? null;
        this.userMessage = params.userMessage ?? null;
        this.raw = params.raw;
    }
}

export const parseBackendErrorResponse = (
    text: string,
    headerCorrelationId: string | null,
    requestCorrelationId: string,
    status: number,
): BackendErrorPayload => {
    const fallbackMessage = `Backend request failed (${status})`;
    let message = fallbackMessage;
    let code: string | null = null;
    let userMessage: string | null = null;
    let correlationId = headerCorrelationId ?? requestCorrelationId;
    let raw: unknown = undefined;

    if (text) {
        try {
            const parsed = JSON.parse(text) as ParsedBackendErrorShape;
            raw = parsed;
            const parsedMessage =
                typeof parsed.message !== 'undefined'
                    ? toErrorMessage(parsed.message, '')
                    : typeof parsed.error?.message !== 'undefined'
                        ? toErrorMessage(parsed.error.message, '')
                        : '';
            const details = isRecord(parsed.error?.details)
                ? (parsed.error?.details as Record<string, unknown>)
                : null;
            message = parsedMessage || toErrorMessage(parsed, fallbackMessage);
            code =
                typeof parsed.code === 'string'
                    ? parsed.code
                    : typeof details?.code === 'string'
                        ? (details.code as string)
                        : null;
            userMessage =
                typeof parsed.userMessage === 'string'
                    ? parsed.userMessage
                    : typeof details?.userMessage === 'string'
                        ? (details.userMessage as string)
                        : typeof details?.message !== 'undefined'
                            ? toErrorMessage(details?.message, '')
                            : null;
            if (!headerCorrelationId) {
                correlationId =
                    typeof parsed.correlationId === 'string' ? parsed.correlationId : requestCorrelationId;
            }
        } catch {
            const fallback = text.trim();
            message = fallback || fallbackMessage;
        }
    }

    message = toErrorMessage(message, fallbackMessage);

    return {
        message,
        code,
        userMessage,
        correlationId,
        raw,
    };
};

type BackendResponse<T> = T;

type TelegramRequestContext = {
    correlationId: string;
};

const telegramRequestContext = new AsyncLocalStorage<TelegramRequestContext>();

@Injectable()
export class TelegramBackendClient {
    constructor(
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) {
        const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
        if (botToken && botToken === this.telegramInternalToken) {
            this.logger.error(
                {
                    event: 'telegram_internal_token_collision',
                    message: 'TELEGRAM_INTERNAL_TOKEN must not equal TELEGRAM_BOT_TOKEN',
                },
                'TelegramBackendClient',
            );
            this.logger.warn(
                {
                    event: 'telegram_internal_token_collision_warning',
                },
                'TelegramBackendClient',
            );
        }

        this.logger.log(
            {
                event: 'telegram_backend_config',
                baseUrl: this.baseUrl,
                internalApiTokenSet: Boolean(this.token),
                internalApiTokenMasked: this.maskToken(this.token),
                telegramInternalTokenSet: Boolean(this.telegramInternalToken),
                telegramInternalTokenMasked: this.maskToken(this.telegramInternalToken),
            },
            'TelegramBackendClient',
        );
    }

    private get baseUrl() {
        const raw = this.configService.get<string>(
            'TELEGRAM_BACKEND_URL',
            'http://localhost:4002',
        );
        return this.ensureApiPrefix(raw);
    }

    private get token() {
        return this.configService.get<string>('INTERNAL_API_TOKEN', '');
    }

    private get requestTimeoutMs() {
        const raw = this.configService.get<string>('TELEGRAM_BACKEND_TIMEOUT_MS', '9000');
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        return 9000;
    }

    private get telegramInternalToken() {
        return this.configService.get<string>('TELEGRAM_INTERNAL_TOKEN', '');
    }

    private maskToken(token: string) {
        if (!token) return null;
        const visible = 4;
        if (token.length <= visible * 2) {
            return `${token.slice(0, 2)}***${token.slice(-2)}`;
        }
        return `${token.slice(0, visible)}***${token.slice(-visible)}`;
    }

    private ensureApiPrefix(baseUrl: string) {
        const trimmed = baseUrl.replace(/\/+$/, '');
        if (/\/api(\/|$)/.test(trimmed)) {
            return trimmed;
        }
        return `${trimmed}/api`;
    }

    private async request<T>(
        path: string,
        options: {
            method: string;
            body?: unknown;
            headers?: Record<string, string>;
            idempotent?: boolean;
        },
    ): Promise<BackendResponse<T>> {
        const rawBody = options.body ? JSON.stringify(options.body) : undefined;
        const storedCorrelationId = telegramRequestContext.getStore()?.correlationId;
        const requestCorrelationId = storedCorrelationId ?? randomUUID();
        const signatureHeaders =
            options.headers?.['X-Telegram-Internal-Token']
                ? {}
                : this.buildTelegramSignatureHeaders(rawBody ?? '{}');
        const maxAttempts = options.idempotent ? 2 : 1;
        let attempt = 0;

        while (attempt < maxAttempts) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const response = await fetch(`${this.baseUrl}${path}`, {
                    method: options.method,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-token': this.token,
                        'x-correlation-id': requestCorrelationId,
                        ...signatureHeaders,
                        ...options.headers,
                    },
                    body: rawBody,
                    signal: controller.signal,
                });

                const headerCorrelationId = response.headers.get('x-correlation-id');
                const responseCorrelationId = headerCorrelationId ?? requestCorrelationId;
                this.logger.log(
                    {
                        event: 'telegram_backend_request',
                        path,
                        status: response.status,
                        correlationId: responseCorrelationId,
                        attempt,
                    },
                    'TelegramBackendClient',
                );

                if (!response.ok) {
                    if (options.idempotent && response.status >= 500 && attempt + 1 < maxAttempts) {
                        attempt += 1;
                        continue;
                    }
                    const text = await response.text();
                    const parsed = parseBackendErrorResponse(
                        text,
                        headerCorrelationId,
                        requestCorrelationId,
                        response.status,
                    );
                    this.logger.error(
                        {
                            event: 'telegram_backend_request_failed',
                            path,
                            statusCode: response.status,
                            code: parsed.code,
                            correlationId: parsed.correlationId,
                        },
                        'TelegramBackendClient',
                    );
                    throw new BackendApiError({
                        status: response.status,
                        code: parsed.code,
                        correlationId: parsed.correlationId,
                        message: parsed.message,
                        userMessage: parsed.userMessage,
                        raw: parsed.raw,
                    });
                }

                return (await response.json()) as BackendResponse<T>;
            } catch (err) {
                if ((err as { name?: string }).name === 'AbortError') {
                    this.logger.error(
                        {
                            event: 'telegram_backend_timeout',
                            path,
                            correlationId: requestCorrelationId,
                            timeoutMs: this.requestTimeoutMs,
                        },
                        'TelegramBackendClient',
                    );
                    throw new BackendApiError({
                        status: 504,
                        code: 'REQUEST_TIMEOUT',
                        correlationId: requestCorrelationId,
                        message: `Backend request timed out after ${this.requestTimeoutMs}ms`,
                        userMessage: null,
                        raw: null,
                    });
                }
                if (options.idempotent && attempt + 1 < maxAttempts) {
                    this.logger.error(
                        {
                            event: 'telegram_backend_retry',
                            path,
                            correlationId: requestCorrelationId,
                            attempt,
                            error: err instanceof Error ? err.message : String(err),
                        },
                        'TelegramBackendClient',
                    );
                    attempt += 1;
                    continue;
                }
                this.logger.error(
                    {
                        event: 'telegram_backend_request_error',
                        path,
                        correlationId: requestCorrelationId,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    'TelegramBackendClient',
                );
                throw new BackendApiError({
                    status: 500,
                    code: 'REQUEST_FAILED',
                    correlationId: requestCorrelationId,
                    message: err instanceof Error ? err.message : String(err),
                    userMessage: null,
                    raw: null,
                });
            } finally {
                clearTimeout(timeoutId);
            }
        }

        throw new BackendApiError({
            status: 500,
            code: 'REQUEST_FAILED',
            correlationId: requestCorrelationId,
            message: 'Backend request failed after retries',
            userMessage: null,
            raw: null,
        });
    }

    runWithCorrelationId<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
        return telegramRequestContext.run({ correlationId }, fn);
    }

    createDepositIntent(params: {
        userId: string;
        amount: string;
        idempotencyKey: string;
        returnUrl?: string;
    }) {
        return this.request<{ id: string; paymentUrl: string | null }>(
            '/internal/payments/deposit-intents',
            { method: 'POST', body: params },
        );
    }

    startTelegramSession(params: {
        telegramId: string;
        username?: string | null;
        startPayload?: string | null;
        updateId?: string | null;
    }) {
        const body = {
            telegramId: params.telegramId,
            username: params.username ?? null,
            startPayload: params.startPayload ?? null,
            updateId: params.updateId ?? null,
        };
        const signatureHeaders = this.buildTelegramSignatureHeaders(JSON.stringify(body));
        return this.request<{
            ok: boolean;
            idempotent: boolean;
            user: {
                id: string;
                telegramId: string | null;
                role: string;
                roles: string[];
                username: string | null;
                status: string;
            };
            created: boolean;
            linkedInvite: boolean;
        }>('/auth/telegram/start', {
            method: 'POST',
            headers: {
                ...signatureHeaders,
            },
            body,
            idempotent: true,
        });
    }

    private buildTelegramSignatureHeaders(rawBody: string) {
        if (!this.telegramInternalToken) {
            throw new Error('TELEGRAM_INTERNAL_TOKEN is required for bot authentication');
        }
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = createHmac('sha256', this.telegramInternalToken)
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
        return {
            'X-Telegram-Internal-Token': this.telegramInternalToken,
            'X-Telegram-Timestamp': timestamp,
            'X-Telegram-Signature': signature,
        };
    }

    ensureAdvertiser(params: { telegramId: string }) {
        return this.request<{
            user: { id: string; role: string; roles: string[]; telegramId: string | null; username: string | null };
        }>('/internal/telegram/advertiser/ensure', {
            method: 'POST',
            body: params,
            idempotent: true,
        });
    }

    ensurePublisher(params: { telegramId: string }) {
        return this.request<{
            user: { id: string; role: string; roles: string[]; telegramId: string | null; username: string | null };
        }>('/internal/telegram/publisher/ensure', {
            method: 'POST',
            body: params,
            idempotent: true,
        });
    }

    resolvePublisher(params: { identifier: string }) {
        return this.request<TelegramResolvePublisherResult>('/internal/telegram/advertiser/resolve-publisher', {
            method: 'POST',
            body: params,
            idempotent: true,
        });
    }

    lookupAdDeal(params: { adDealId: string }) {
        return this.request<{
            adDeal: {
                id: string;
                advertiserId: string;
                publisherId: string;
                amount: string;
            };
        }>('/internal/telegram/addeals/lookup', {
            method: 'POST',
            body: params,
            idempotent: true,
        });
    }

    verifyPublisherChannel(params: {
        publisherId: string;
        telegramUserId: string;
        identifier: string;
    }) {
        return this.request<{ ok: boolean; message: string }>(
            '/internal/telegram/publisher/verify-channel',
            { method: 'POST', body: params, idempotent: true },
        );
    }

    verifyPublisherPrivateChannel(params: {
        publisherId: string;
        telegramUserId: string;
    }) {
        return this.request<{ ok: boolean; message: string }>(
            '/internal/telegram/publisher/verify-private-channel',
            { method: 'POST', body: params, idempotent: true },
        );
    }

    adminForceRelease(params: { telegramId: string; campaignTargetId: string }) {
        return this.request<{ ok: boolean }>(
            '/internal/telegram/admin/force-release',
            { method: 'POST', body: params },
        );
    }

    adminForceRefund(params: {
        telegramId: string;
        campaignTargetId: string;
        reason?: string;
    }) {
        return this.request<{ ok: boolean }>(
            '/internal/telegram/admin/force-refund',
            { method: 'POST', body: params },
        );
    }

    adminRetryPost(params: { telegramId: string; postJobId: string }) {
        return this.request<{ ok: boolean }>(
            '/internal/telegram/admin/retry-post',
            { method: 'POST', body: params },
        );
    }

    adminFreezeCampaign(params: { telegramId: string; campaignId: string }) {
        return this.request<{ ok: boolean }>(
            '/internal/telegram/admin/freeze-campaign',
            { method: 'POST', body: params },
        );
    }

    adminUnfreezeCampaign(params: { telegramId: string; campaignId: string }) {
        return this.request<{ ok: boolean }>(
            '/internal/telegram/admin/unfreeze-campaign',
            { method: 'POST', body: params },
        );
    }

    createWithdrawalIntent(params: {
        userId: string;
        amount: string;
        idempotencyKey: string;
    }) {
        return this.request<{ id: string; status: string }>(
            '/internal/payments/withdraw-intents',
            { method: 'POST', body: params },
        );
    }

    createAdDeal(params: { advertiserId: string; publisherId: string; amount: string }) {
        return this.request<{ id: string; amount: string }>(
            '/internal/addeals',
            { method: 'POST', body: params },
        );
    }

    fundAdDeal(params: {
        adDealId: string;
        provider: string;
        providerReference: string;
        amount: string;
    }) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${params.adDealId}/fund`, {
            method: 'POST',
            body: {
                provider: params.provider,
                providerReference: params.providerReference,
                amount: params.amount,
            },
        });
    }

    lockAdDeal(adDealId: string) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${adDealId}/lock`, {
            method: 'POST',
        });
    }

    acceptAdDeal(adDealId: string) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${adDealId}/accept`, {
            method: 'POST',
        });
    }

    declineAdDeal(adDealId: string) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${adDealId}/decline`, {
            method: 'POST',
        });
    }

    confirmAdDeal(adDealId: string) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${adDealId}/confirm`, {
            method: 'POST',
        });
    }

    submitProof(params: { adDealId: string; proofText: string }) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${params.adDealId}/proof`, {
            method: 'POST',
            body: { proofText: params.proofText },
        });
    }

    settleAdDeal(adDealId: string) {
        return this.request<{ ok: boolean }>(`/internal/addeals/${adDealId}/settle`, {
            method: 'POST',
        });
    }
}