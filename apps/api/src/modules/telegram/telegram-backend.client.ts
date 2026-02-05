import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import { TelegramResolvePublisherResult } from './telegram.types';

type BackendResponse<T> = T;

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
        options: { method: string; body?: unknown; headers?: Record<string, string> },
    ): Promise<BackendResponse<T>> {
        const rawBody = options.body ? JSON.stringify(options.body) : undefined;
        const requestCorrelationId = randomUUID();
        const signatureHeaders =
            options.headers?.['X-Telegram-Internal-Token']
                ? {}
                : this.buildTelegramSignatureHeaders(rawBody ?? '{}');
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
        });

        const responseCorrelationId =
            response.headers.get('x-correlation-id') ?? requestCorrelationId;
        this.logger.log(
            {
                event: 'telegram_backend_request',
                path,
                status: response.status,
                correlationId: responseCorrelationId,
            },
            'TelegramBackendClient',
        );

        if (!response.ok) {
            const text = await response.text();
            let message = text;
            let code: string | null = null;
            let correlationId: string | null = responseCorrelationId;
            if (text) {
                try {
                    const parsed = JSON.parse(text) as {
                        message?: unknown;
                        code?: unknown;
                        correlationId?: unknown;
                        error?: { message?: unknown; details?: { code?: unknown } };
                    };
                    const parsedMessage =
                        typeof parsed.message === 'string'
                            ? parsed.message
                            : Array.isArray(parsed.message)
                                ? parsed.message.join('; ')
                                : parsed.error?.message;
                    message = parsedMessage ?? JSON.stringify(parsed);
                    code =
                        typeof parsed.code === 'string'
                            ? parsed.code
                            : typeof parsed.error?.details?.code === 'string'
                                ? parsed.error.details.code
                                : null;
                    correlationId =
                        typeof parsed.correlationId === 'string' ? parsed.correlationId : null;
                } catch {
                    message = text;
                }
            }
            const error = new Error(message || `Backend request failed (${response.status})`);
            (error as { code?: string | null; correlationId?: string | null }).code = code;
            (error as { code?: string | null; correlationId?: string | null }).correlationId = correlationId;
            throw error;
        }

        return (await response.json()) as BackendResponse<T>;
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
        });
    }

    ensurePublisher(params: { telegramId: string }) {
        return this.request<{
            user: { id: string; role: string; roles: string[]; telegramId: string | null; username: string | null };
        }>('/internal/telegram/publisher/ensure', {
            method: 'POST',
            body: params,
        });
    }

    resolvePublisher(params: { identifier: string }) {
        return this.request<TelegramResolvePublisherResult>('/internal/telegram/advertiser/resolve-publisher', {
            method: 'POST',
            body: params,
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
        });
    }

    verifyPublisherChannel(params: {
        publisherId: string;
        telegramUserId: string;
        identifier: string;
    }) {
        return this.request<{ ok: boolean; message: string }>(
            '/internal/telegram/publisher/verify-channel',
            { method: 'POST', body: params },
        );
    }

    verifyPublisherPrivateChannel(params: {
        publisherId: string;
        telegramUserId: string;
    }) {
        return this.request<{ ok: boolean; message: string }>(
            '/internal/telegram/publisher/verify-private-channel',
            { method: 'POST', body: params },
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
