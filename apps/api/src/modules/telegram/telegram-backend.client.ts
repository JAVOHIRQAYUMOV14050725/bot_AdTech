import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BackendResponse<T> = T;

@Injectable()
export class TelegramBackendClient {
    constructor(
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) {
        this.logger.log(
            {
                event: 'telegram_backend_config',
                baseUrl: this.baseUrl,
                internalApiTokenSet: Boolean(this.token),
                internalApiTokenMasked: this.maskToken(this.token),
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
        options: { method: string; body?: unknown },
    ): Promise<BackendResponse<T>> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: options.method,
            headers: {
                'Content-Type': 'application/json',
                'x-internal-token': this.token,
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        if (!response.ok) {
            const text = await response.text();
            let message = text;
            if (text) {
                try {
                    const parsed = JSON.parse(text) as { message?: unknown };
                    if (typeof parsed.message === 'string') {
                        message = parsed.message;
                    } else if (Array.isArray(parsed.message)) {
                        message = parsed.message.join('; ');
                    } else {
                        message = JSON.stringify(parsed);
                    }
                } catch {
                    message = text;
                }
            }
            throw new Error(message || `Backend request failed (${response.status})`);
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
    }) {
        return this.request<{
            user: {
                id: string;
                telegramId: string | null;
                role: string;
                username: string | null;
                status: string;
            };
            created: boolean;
            linkedInvite: boolean;
        }>('/internal/telegram/start', {
            method: 'POST',
            body: {
                telegramId: params.telegramId,
                username: params.username ?? null,
                startPayload: params.startPayload ?? null,
            },
        });
    }

    ensureAdvertiser(params: { telegramId: string }) {
        return this.request<{
            user: { id: string; role: string; telegramId: string | null; username: string | null };
        }>('/internal/telegram/advertiser/ensure', {
            method: 'POST',
            body: params,
        });
    }

    ensurePublisher(params: { telegramId: string }) {
        return this.request<{
            user: { id: string; role: string; telegramId: string | null; username: string | null };
        }>('/internal/telegram/publisher/ensure', {
            method: 'POST',
            body: params,
        });
    }

    resolvePublisher(params: { identifier: string }) {
        return this.request<{
            ok: boolean;
            reason?: string;
            publisher?: { id: string; telegramId: string | null; username: string | null };
            channel?: { id: string; title: string; username: string | null };
            source?: string;
        }>('/internal/telegram/advertiser/resolve-publisher', {
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
