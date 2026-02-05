import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome } from '../keyboards';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { extractTelegramErrorMeta, mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { parseTelegramIdentifier } from '@/common/utils/telegram-username.util';
import { TelegramResolvePublisherFailureReason } from '@/modules/telegram/telegram.types';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { replySafe } from '@/modules/telegram/telegram-safe-text.util';

@Update()
export class AdvertiserHandler {
    private readonly logger = new Logger(AdvertiserHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly backendClient: TelegramBackendClient,
    ) { }

    @Action('ROLE_ADVERTISER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);

        if (!context) {
            return;
        }

        await this.fsm.set(
            userId,
            'advertiser',
            TelegramState.ADV_DASHBOARD,
        );

        await replySafe(
            ctx,
            `🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
            advertiserHome,
        );
    }

    @Action('ADD_BALANCE')
    async addBalance(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADD_BALANCE_AMOUNT,
        );

        await replySafe(ctx, '💰 Enter amount (USD):');
    }

    @Action('CREATE_ADDEAL')
    async beginCreateAdDeal(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADDEAL_PUBLISHER,
        );

        await replySafe(
            ctx,
            '🤝 Send the publisher @username or a public channel/group link (t.me/...).',
        );
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const commandMatch = text.match(/^\/(fund_addeal|lock_addeal)\s+(\S+)/);
        if (commandMatch) {
            const [, command, adDealId] = commandMatch;
            const context = await this.ensureAdvertiser(ctx);
            if (!context) {
                return;
            }
            const fsm = context.fsm;
            try {
                const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

                if (adDeal.adDeal.advertiserId !== context.user.id) {
                    return replySafe(ctx, '❌ AdDeal not found for advertiser');
                }

                if (command === 'fund_addeal') {
                    await this.backendClient.fundAdDeal({
                        adDealId,
                        provider: 'wallet_balance',
                        providerReference: `telegram:${userId}:${adDealId}`,
                        amount: adDeal.adDeal.amount,
                    });
                    return replySafe(ctx, `✅ AdDeal funded\nID: ${adDealId}`);
                }

                if (command === 'lock_addeal') {
                    await this.backendClient.lockAdDeal(adDealId);
                    return replySafe(ctx, `🔒 Escrow locked\nID: ${adDealId}`);
                }
            } catch (err) {
                const message = mapBackendErrorToTelegramMessage(err);
                const { code, correlationId } = extractTelegramErrorMeta(err);
                this.logger.error({
                    event: 'telegram_addeal_command_failed',
                    command,
                    adDealId,
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                    code,
                    correlationId,
                });
                return replySafe(ctx, message);
            }
        }

        const publisherResolution = await this.resolvePublisherInput(text);
        if (publisherResolution) {
            if (!publisherResolution.ok) {
                return replySafe(ctx, this.mapResolvePublisherReason(publisherResolution));
            }

            const context = await this.ensureAdvertiser(ctx);
            if (!context) {
                return;
            }

            const publisher = publisherResolution.publisher;
            if (!publisher) {
                return replySafe(ctx, '❌ Publisher not found. Send a valid @username or a public channel/group link.');
            }
            if (publisher.id === context.user.id) {
                return replySafe(ctx, '❌ You cannot create a deal with yourself.');
            }

            this.logger.log({
                event: 'publisher_resolved',
                advertiserId: context.user.id,
                publisherId: publisher.id,
                publisherTelegramId: publisher.telegramId?.toString(),
                source: publisherResolution.source,
                channelId: publisherResolution.channel?.id ?? null,
            });

            await this.fsm.transition(
                userId,
                TelegramState.ADV_ADDEAL_AMOUNT,
                { publisherId: publisher.id },
            );

            const publisherLabel =
                publisher.username
                    ? `@${publisher.username}`
                    : publisherResolution.channel?.title ?? 'publisher';

            return replySafe(
                ctx,
                `✅ Publisher selected: ${publisherLabel}\n💵 Enter deal amount (USD):`,
            );
        }

        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }
        const fsm = context.fsm;

        if (fsm.state === TelegramState.ADV_ADD_BALANCE_AMOUNT) {
            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return replySafe(ctx, '❌ Invalid amount');
            }
            const amount = new Decimal(amountText);
            if (amount.lte(0)) {
                return replySafe(ctx, '❌ Invalid amount');
            }

            try {
                const idempotencyKey = `telegram:deposit:${userId}:${randomUUID()}`;
                const intent = await this.backendClient.createDepositIntent({
                    userId: context.user.id,
                    amount: amount.toFixed(2),
                    idempotencyKey,
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                    { amount: amount.toFixed(2) },
                );

                return replySafe(
                    ctx,
                    `✅ Deposit intent created\nAmount: $${amount.toFixed(2)}\nPay here: ${intent.paymentUrl ?? 'pending'}`,
                );
            } catch (err) {
                const message = mapBackendErrorToTelegramMessage(err);
                const { code, correlationId } = extractTelegramErrorMeta(err);
                this.logger.error({
                    event: 'telegram_deposit_failed',
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                    code,
                    correlationId,
                });
                return replySafe(ctx, message);
            }
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_PUBLISHER) {
            return replySafe(
                ctx,
                '❌ Please send a publisher @username or a public channel/group link (t.me/...).',
            );
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_AMOUNT) {
            if (!fsm.payload.publisherId) {
                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_ADDEAL_PUBLISHER,
                );
                return replySafe(
                    ctx,
                    '⚠️ Please select a publisher first by sending @username or a public channel/group link (t.me/...).',
                );
            }

            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return replySafe(ctx, '❌ Invalid amount');
            }

            if (new Decimal(amountText).lte(0)) {
                return replySafe(ctx, '❌ Invalid amount');
            }

            try {
                const adDeal = await this.backendClient.createAdDeal({
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                    amount: amountText,
                });

                this.logger.log({
                    event: 'addeal_created',
                    adDealId: adDeal.id,
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                    amount: amountText,
                });

                await this.backendClient.fundAdDeal({
                    adDealId: adDeal.id,
                    provider: 'wallet_balance',
                    providerReference: `telegram:${userId}:${adDeal.id}`,
                    amount: amountText,
                });

                await this.backendClient.lockAdDeal(adDeal.id);

                this.logger.log({
                    event: 'escrow_locked',
                    adDealId: adDeal.id,
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                );

                return replySafe(
                    ctx,
                    `✅ AdDeal created & escrow locked\nID: ${adDeal.id}\n\n` +
                    `Next steps:\n` +
                    `• Publisher: /accept_addeal ${adDeal.id}\n` +
                    `• Publisher: /submit_proof ${adDeal.id} <proof>`,
                );
            } catch (err) {
                const message = mapBackendErrorToTelegramMessage(err);
                const { code, correlationId } = extractTelegramErrorMeta(err);
                this.logger.error({
                    event: 'telegram_addeal_create_failed',
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                    code,
                    correlationId,
                });
                return replySafe(ctx, message);
            }
        }

        if (
            fsm.state === TelegramState.IDLE
            || fsm.state === TelegramState.SELECT_ROLE
        ) {
            await replySafe(ctx, 'ℹ️ Session expired. Use /start to choose your role.');
            return;
        }

        return undefined;
    }

    private async resolvePublisherInput(value: string) {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const parsed = parseTelegramIdentifier(trimmed);
        const identifier = parsed.normalized ?? trimmed;

        return this.backendClient.resolvePublisher({ identifier });
    }

    private mapResolvePublisherReason(result: { reason?: TelegramResolvePublisherFailureReason }) {
        switch (result.reason) {
            case 'CHANNEL_NOT_FOUND':
                return '❌ Bu kanal hali marketplace’da yo‘q. Egasi onboarding + verifikatsiya qilsin.';
            case 'CHANNEL_NOT_APPROVED':
                return '⏳ Kanal hali marketplace’da tasdiqlanmagan. Admin ko‘rib chiqmoqda.';
            case 'CHANNEL_NOT_OWNED_BY_PUBLISHER':
                return '❌ Kanal egasi publisher akkaunt emas.';
            case 'PUBLISHER_NOT_REGISTERED':
                return '❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.';
            case 'INVALID_PUBLISHER_IDENTIFIER':
                return '❌ @username yoki t.me link noto‘g‘ri.';
            default:
                return '❌ Iltimos, to‘g‘ri @username yoki t.me link yuboring.';
        }
    }

    private async ensureAdvertiser(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return null;
        }

        let userResponse;
        try {
            userResponse = await this.backendClient.ensureAdvertiser({
                telegramId: userId.toString(),
            });
        } catch (err) {
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_advertiser_ensure_failed',
                userId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
            return null;
        }

        const user = userResponse.user;

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'advertiser'
                ? await this.fsm.updateRole(userId, 'advertiser')
                : fsm;

        return { user, fsm: syncedFsm };
    }
}
