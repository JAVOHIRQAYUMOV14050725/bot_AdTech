import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BackendResponse<T> = T;

@Injectable()
export class TelegramBackendClient {
    constructor(private readonly configService: ConfigService) { }

    private get baseUrl() {
        return this.configService.get<string>(
            'TELEGRAM_BACKEND_URL',
            'http://localhost:4002',
        );
    }

    private get token() {
        return this.configService.get<string>('INTERNAL_API_TOKEN', '');
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
            throw new Error(text || `Backend request failed (${response.status})`);
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