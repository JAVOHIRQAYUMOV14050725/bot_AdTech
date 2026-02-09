import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramFlow, TelegramFlowStep } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome, backToAdvertiserMenuKeyboard, cancelFlowKeyboard } from '../keyboards';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { extractTelegramErrorMeta, mapBackendErrorToTelegramResponse } from '@/modules/telegram/telegram-error.util';
import { normalizeTelegramIdentifierInput } from '@/common/utils/telegram-username.util';
import { TelegramResolvePublisherFailureReason, TelegramResolvePublisherResult } from '@/modules/telegram/telegram.types';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { ackNow, replySafe, resolveTelegramLocale, startTelegramProgress } from '@/modules/telegram/telegram-safe-text.util';
import { TelegramUserLockService } from '@/modules/telegram/telegram-user-lock.service';
import { resolveTelegramCorrelationId } from '@/modules/telegram/telegram-context.util';

@Update()
export class AdvertiserHandler {
    private readonly logger = new Logger(AdvertiserHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly backendClient: TelegramBackendClient,
        private readonly lockService: TelegramUserLockService,
    ) { }

    @Action('ROLE_ADVERTISER')
    async enter(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.set(
                        userId,
                        'advertiser',
                        TelegramFlow.NONE,
                        TelegramFlowStep.NONE,
                    );
                    await progress.finish(
                        `🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
                        advertiserHome,
                    );
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('ADV_BALANCE')
    async showBalance(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    const balance = await this.backendClient.getAdvertiserBalance({
                        userId: context.user.id,
                    });
                    await progress.finish(
                        `💰 Balance: ${balance.currency} ${balance.balance}`,
                        backToAdvertiserMenuKeyboard,
                    );
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('ADV_BROWSE_CHANNELS')
    async browseChannels(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }

                    const response = await this.backendClient.listMarketplaceChannels({
                        page: 1,
                        pageSize: 5,
                    });

                    if (response.channels.length === 0) {
                        await progress.finish('📭 No approved channels available yet.', backToAdvertiserMenuKeyboard);
                        return;
                    }

                    const lines = response.channels.map((channel, index) => {
                        const handle = channel.username ? `@${channel.username}` : channel.title;
                        return `${index + 1}. ${channel.title} (${handle}) — subs ${channel.subscriberCount}`;
                    });

                    const keyboard = Markup.inlineKeyboard(
                        response.channels.map((channel) => [
                            Markup.button.callback(
                                `Select: ${channel.title}`,
                                `ADV_SELECT_CHANNEL:${channel.id}:${channel.ownerId}`,
                            ),
                        ]),
                    );

                    await progress.finish(`📢 Approved channels:\n${lines.join('\n')}`, keyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action(/ADV_SELECT_CHANNEL:(.+)/)
    async selectChannel(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        const payload = typeof ctx.match?.[1] === 'string' ? ctx.match[1] : '';
        const [channelId, publisherId] = payload.split(':');
        if (!channelId || !publisherId) {
            await replySafe(ctx, '❌ Channel selection invalid.');
            return;
        }
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.CREATE_AD_DEAL,
                        TelegramFlowStep.ADV_ADDEAL_AMOUNT,
                        { publisherId, channelId },
                    );
                    await progress.finish('💵 Enter deal amount (USD):', cancelFlowKeyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('ADV_MY_DEALS')
    async listDeals(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    const response = await this.backendClient.listAdvertiserDeals({
                        userId: context.user.id,
                        page: 1,
                        pageSize: 5,
                    });
                    if (response.deals.length === 0) {
                        await progress.finish('📭 No deals found yet.', backToAdvertiserMenuKeyboard);
                        return;
                    }
                    const lines = response.deals.map((deal) => {
                        const channelLabel = deal.channel?.title ?? 'Direct';
                        const publisherLabel = deal.publisher ? `@${deal.publisher}` : 'publisher';
                        return `• ${deal.id}\n  ${channelLabel} → ${publisherLabel}\n  $${deal.amount} • ${deal.status}`;
                    });
                    await progress.finish(lines.join('\n'), backToAdvertiserMenuKeyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('ADV_DISPUTES')
    async listDisputes(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    const response = await this.backendClient.listAdvertiserDisputes({
                        userId: context.user.id,
                        page: 1,
                        pageSize: 5,
                    });
                    if (response.disputes.length === 0) {
                        await progress.finish('📭 No disputes on your deals yet.', backToAdvertiserMenuKeyboard);
                        return;
                    }
                    const lines = response.disputes.map((dispute) => {
                        return `• ${dispute.adDealId}\n  ${dispute.reason}\n  Status: ${dispute.status}`;
                    });
                    await progress.finish(lines.join('\n'), backToAdvertiserMenuKeyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('ADD_BALANCE')
    async addBalance(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.ADD_BALANCE,
                        TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT,
                    );
                    await progress.finish('💰 Enter amount (USD):', cancelFlowKeyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('CREATE_ADDEAL')
    async beginCreateAdDeal(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.CREATE_AD_DEAL,
                        TelegramFlowStep.ADV_ADDEAL_PUBLISHER,
                    );
                    await progress.finish(
                        '🤝 Send the publisher @username or a public channel/group link (t.me/...).',
                        cancelFlowKeyboard,
                    );
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('CREATE_CAMPAIGN')
    async beginCreateCampaign(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                try {
                    const context = await this.ensureAdvertiser(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.CREATE_CAMPAIGN,
                        TelegramFlowStep.ADV_CREATE_CAMPAIGN_NAME,
                    );
                    await progress.finish('📝 Campaign name kiriting:', cancelFlowKeyboard);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    await progress.finish(presentation.message, presentation.keyboard);
                }
            });
        });
    }

    @Action('CANCEL_FLOW')
    async cancelFlow(@Ctx() ctx: Context) {
        await ackNow(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        await this.withUserLock(ctx, async () => {
            await this.fsm.clearFlow(userId);
            await replySafe(ctx, '✅ Bekor qilindi.');
        });
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        await this.withUserLock(ctx, async () => {
            const fsmSnapshot = await this.fsm.get(userId);
            if (fsmSnapshot.role !== 'advertiser') {
                return;
            }
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                let context;
                try {
                    context = await this.ensureAdvertiser(ctx);
                } catch (err) {
                    const presentation = mapBackendErrorToTelegramResponse(err, locale);
                    const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                    this.logger.error({
                        event: 'telegram_advertiser_ensure_failed',
                        userId,
                        code,
                        correlationId: errorCorrelationId,
                        error: presentation.message,
                    });
                    await progress.finish(presentation.message, presentation.keyboard);
                    return;
                }
                if (!context) {
                    await progress.finish('❌ Telegram user not found.');
                    return;
                }
                const fsm = context.fsm;

                const commandMatch = text.match(/^\/(fund_addeal|lock_addeal|confirm_addeal)\s+(\S+)/);
                if (commandMatch) {
                    const [, command, adDealId] = commandMatch;
                    try {
                        const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

                        if (adDeal.adDeal.advertiserId !== context.user.id) {
                            await progress.finish('❌ AdDeal not found for advertiser');
                            return;
                        }

                        if (command === 'fund_addeal') {
                            await this.backendClient.fundAdDeal({
                                adDealId,
                                provider: 'wallet_balance',
                                providerReference: `telegram:${userId}:${adDealId}`,
                                amount: adDeal.adDeal.amount,
                            });
                            await progress.finish(`✅ AdDeal funded\nID: ${adDealId}`);
                            return;
                        }

                        if (command === 'lock_addeal') {
                            await this.backendClient.lockAdDeal(adDealId);
                            await progress.finish(`🔒 Escrow locked\nID: ${adDealId}`);
                            return;
                        }

                        if (command === 'confirm_addeal') {
                            if (adDeal.adDeal.advertiserId !== context.user.id) {
                                await progress.finish('❌ AdDeal not found for advertiser');
                                return;
                            }
                            await this.backendClient.confirmAdDeal(adDealId);
                            await progress.finish(`✅ AdDeal confirmed\nID: ${adDealId}`);
                            return;
                        }
                    } catch (err) {
                        const presentation = mapBackendErrorToTelegramResponse(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        this.logger.error({
                            event: 'telegram_addeal_command_failed',
                            command,
                            adDealId,
                            userId,
                            role: fsm.role,
                            flow: fsm.flow,
                            step: fsm.step,
                            error: presentation.message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(presentation.message, presentation.keyboard);
                        return;
                    }
                }

                const expectedSteps = new Set([
                    `${TelegramFlow.ADD_BALANCE}:${TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT}`,
                    `${TelegramFlow.CREATE_AD_DEAL}:${TelegramFlowStep.ADV_ADDEAL_PUBLISHER}`,
                    `${TelegramFlow.CREATE_AD_DEAL}:${TelegramFlowStep.ADV_ADDEAL_AMOUNT}`,
                    `${TelegramFlow.CREATE_CAMPAIGN}:${TelegramFlowStep.ADV_CREATE_CAMPAIGN_NAME}`,
                ]);

                if (!expectedSteps.has(`${fsm.flow}:${fsm.step}`)) {
                    if (fsm.flow === TelegramFlow.NONE) {
                        await progress.finish('ℹ️ Session expired. Use /start to choose your role.', advertiserHome);
                        return;
                    }
                    await progress.finish('❌ Iltimos, ko‘rsatilgan qadamlardan foydalaning.', cancelFlowKeyboard);
                    return;
                }

                if (fsm.flow === TelegramFlow.CREATE_AD_DEAL && fsm.step === TelegramFlowStep.ADV_ADDEAL_PUBLISHER) {
                    let publisherResolution
                        : TelegramResolvePublisherResult | null = null;
                    try {
                        publisherResolution = await this.resolvePublisherInput(text);
                    } catch (err) {
                        const presentation = mapBackendErrorToTelegramResponse(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        this.logger.error({
                            event: 'telegram_resolve_publisher_failed',
                            userId,
                            error: presentation.message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(presentation.message, presentation.keyboard);
                        return;
                    }
                    if (publisherResolution) {
                        if (!publisherResolution.ok) {
                            const mappedCode = this.mapResolvePublisherErrorCode(publisherResolution.reason);
                            if (mappedCode) {
                                const presentation = mapBackendErrorToTelegramResponse({ code: mappedCode }, locale);
                                await progress.finish(presentation.message, presentation.keyboard);
                                return;
                            }
                            await progress.finish(this.mapResolvePublisherReason(publisherResolution), cancelFlowKeyboard);
                            return;
                        }

                        const publisher = publisherResolution.publisher;
                        if (!publisher) {
                            const presentation = mapBackendErrorToTelegramResponse({ code: 'PUBLISHER_NOT_FOUND' }, locale);
                            await progress.finish(presentation.message, presentation.keyboard);
                            return;
                        }
                        if (publisher.id === context.user.id) {
                            await progress.finish('❌ You cannot create a deal with yourself.', cancelFlowKeyboard);
                            return;
                        }

                        this.logger.log({
                            event: 'publisher_resolved',
                            advertiserId: context.user.id,
                            publisherId: publisher.id,
                            publisherTelegramId: publisher.telegramId?.toString(),
                            source: publisherResolution.source,
                            channelId: publisherResolution.channel?.id ?? null,
                        });

                        const publisherLabel =
                            publisher.username
                                ? `@${publisher.username}`
                                : publisherResolution.channel?.title ?? 'publisher';

                        await this.fsm.startFlow(
                            userId,
                            TelegramFlow.CREATE_AD_DEAL,
                            TelegramFlowStep.ADV_ADDEAL_AMOUNT,
                            {
                                publisherId: publisher.id,
                                publisherTelegramId: publisher.telegramId ?? null,
                                publisherLabel,
                                channelId: publisherResolution.channel?.id ?? null,
                            },
                        );

                        await progress.finish(
                            `✅ Publisher selected: ${publisherLabel}\n💵 Enter deal amount (USD):`,
                            cancelFlowKeyboard,
                        );
                        return;
                    }
                    await progress.finish(
                        '❌ Please send a publisher @username or a public channel/group link (t.me/...).',
                        cancelFlowKeyboard,
                    );
                    return;
                }

                if (fsm.flow === TelegramFlow.ADD_BALANCE && fsm.step === TelegramFlowStep.ADV_ADD_BALANCE_AMOUNT) {
                    const amountText = text.trim();
                    if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                        await progress.finish('❌ Invalid amount', cancelFlowKeyboard);
                        return;
                    }
                    const amount = new Decimal(amountText);
                    if (amount.lte(0)) {
                        await progress.finish('❌ Invalid amount', cancelFlowKeyboard);
                        return;
                    }

                    try {
                        const idempotencyKey = `telegram:deposit:${userId}:${randomUUID()}`;
                        const intent = await this.backendClient.createDepositIntent({
                            userId: context.user.id,
                            amount: amount.toFixed(2),
                            idempotencyKey,
                        });

                        await this.fsm.clearFlow(userId);

                        if (intent.paymentUrl) {
                            await progress.finish(
                                `✅ Deposit intent created\nAmount: $${amount.toFixed(2)}\nPay here: ${intent.paymentUrl}`,
                            );
                            return;
                        }

                        const fallbackCorrelationId = resolveTelegramCorrelationId(ctx);
                        await progress.finish(
                            `Payment temporarily unavailable. Error ID: ${fallbackCorrelationId} — please retry later.`,
                            cancelFlowKeyboard,
                        );
                        return;
                    } catch (err) {
                        const presentation = mapBackendErrorToTelegramResponse(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        if (code === 'PAYMENTS_DISABLED') {
                            await this.fsm.clearFlow(userId);
                        }
                        this.logger.error({
                            event: 'telegram_deposit_failed',
                            userId,
                            role: fsm.role,
                            flow: fsm.flow,
                            step: fsm.step,
                            error: presentation.message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(presentation.message, presentation.keyboard);
                        return;
                    }
                }

                if (fsm.flow === TelegramFlow.CREATE_AD_DEAL && fsm.step === TelegramFlowStep.ADV_ADDEAL_AMOUNT) {
                    if (!fsm.payload.publisherId) {
                        await this.fsm.startFlow(
                            userId,
                            TelegramFlow.CREATE_AD_DEAL,
                            TelegramFlowStep.ADV_ADDEAL_PUBLISHER,
                        );
                        await progress.finish(
                            '⚠️ Please select a publisher first by sending @username or a public channel/group link (t.me/...).',
                            cancelFlowKeyboard,
                        );
                        return;
                    }

                    const amountText = text.trim();
                    if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                        await progress.finish('❌ Invalid amount', cancelFlowKeyboard);
                        return;
                    }

                    if (new Decimal(amountText).lte(0)) {
                        await progress.finish('❌ Invalid amount', cancelFlowKeyboard);
                        return;
                    }

                    try {
                        const correlationId = resolveTelegramCorrelationId(ctx);
                        const idempotencyKey = `telegram:addeal:${userId}:${randomUUID()}`;
                        const adDeal = await this.backendClient.createAdDeal({
                            advertiserId: context.user.id,
                            publisherId: fsm.payload.publisherId,
                            channelId: fsm.payload.channelId ?? null,
                            amount: amountText,
                            idempotencyKey,
                            correlationId,
                        });

                        this.logger.log({
                            event: 'addeal_created',
                            adDealId: adDeal.id,
                            advertiserId: context.user.id,
                            publisherId: fsm.payload.publisherId,
                            amount: amountText,
                        });

                        this.logger.log({
                            event: 'escrow_locked',
                            adDealId: adDeal.id,
                            advertiserId: context.user.id,
                            publisherId: fsm.payload.publisherId,
                        });

                        const publisherTelegramId = fsm.payload.publisherTelegramId
                            ? Number(fsm.payload.publisherTelegramId)
                            : null;
                        if (publisherTelegramId) {
                            try {
                                await ctx.telegram.sendMessage(
                                    publisherTelegramId,
                                    `📩 New ad deal offer!\nDeal ID: ${adDeal.id}\nAmount: $${amountText}\n` +
                                    `Reply with:\n• /accept_addeal ${adDeal.id}\n• /decline_addeal ${adDeal.id}`,
                                );
                            } catch (notifyError) {
                                this.logger.warn({
                                    event: 'publisher_notify_failed',
                                    adDealId: adDeal.id,
                                    publisherTelegramId,
                                    error:
                                        notifyError instanceof Error
                                            ? notifyError.message
                                            : String(notifyError),
                                });
                            }
                        }

                        await this.fsm.clearFlow(userId);

                        await progress.finish(
                            `✅ AdDeal created & escrow locked\nID: ${adDeal.id}\n\n` +
                            `Next steps:\n` +
                            `• Publisher: /accept_addeal ${adDeal.id}\n` +
                            `• Publisher: /decline_addeal ${adDeal.id}\n` +
                            `• Advertiser: /confirm_addeal ${adDeal.id}\n` +
                            `• Publisher (after confirm): /submit_proof ${adDeal.id} <proof>`,
                        );
                        return;
                    } catch (err) {
                        const presentation = mapBackendErrorToTelegramResponse(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        if (code === 'INSUFFICIENT_WALLET_BALANCE') {
                            await this.fsm.clearFlow(userId);
                        }
                        this.logger.error({
                            event: 'telegram_addeal_create_failed',
                            userId,
                            role: fsm.role,
                            flow: fsm.flow,
                            step: fsm.step,
                            error: presentation.message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(presentation.message, presentation.keyboard);
                        return;
                    }
                }

                if (fsm.flow === TelegramFlow.CREATE_CAMPAIGN && fsm.step === TelegramFlowStep.ADV_CREATE_CAMPAIGN_NAME) {
                    await this.fsm.clearFlow(userId);
                    await progress.finish(
                        '🛠 Campaign creation is not available yet. Please contact support.',
                        advertiserHome,
                    );
                    return;
                }

                await progress.finish('❌ Iltimos, ko‘rsatilgan qadamlardan foydalaning.', cancelFlowKeyboard);
            });
        });
    }

    private async resolvePublisherInput(value: string) {
        const normalized = normalizeTelegramIdentifierInput(value);
        if (!normalized.canonical) {
            const error = new Error('Invalid channel input');
            (error as Error & { code?: string; userMessage?: string }).code = 'INVALID_CHANNEL_INPUT';
            (error as Error & { code?: string; userMessage?: string }).userMessage = '❌ @username yoki t.me link noto‘g‘ri.';
            throw error;
        }
        return this.backendClient.resolvePublisher({ identifier: normalized.canonical });
    }

    private mapResolvePublisherReason(result: { reason?: TelegramResolvePublisherFailureReason }) {
        switch (result.reason) {
            case 'CHANNEL_NOT_FOUND':
                return '❌ Bu kanal hali marketplace’da yo‘q. Egasi onboarding + verifikatsiya qilsin.';
            case 'CHANNEL_NOT_APPROVED':
                return '⏳ Kanal hali marketplace’da tasdiqlanmagan (pending).';
            case 'CHANNEL_OWNER_NOT_PUBLISHER':
                return '❌ Kanal egasi publisher akkaunt emas.';
            case 'PUBLISHER_NOT_REGISTERED':
                return '❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.';
            case 'IDENTIFIER_INVALID':
                return '❌ @username yoki t.me link noto‘g‘ri.';
            default:
                return '❌ Iltimos, to‘g‘ri @username yoki t.me link yuboring.';
        }
    }

    private mapResolvePublisherErrorCode(reason?: TelegramResolvePublisherFailureReason) {
        switch (reason) {
            case 'IDENTIFIER_INVALID':
                return 'INVALID_CHANNEL_INPUT';
            case 'CHANNEL_NOT_FOUND':
                return 'PUBLISHER_NOT_FOUND';
            default:
                return null;
        }
    }

    private async ensureAdvertiser(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            return null;
        }

        const userResponse = await this.backendClient.ensureAdvertiser({
            telegramId: userId.toString(),
        });

        const user = userResponse.user;

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'advertiser'
                ? await this.fsm.updateRole(userId, 'advertiser')
                : fsm;

        return { user, fsm: syncedFsm };
    }

    private async withUserLock(ctx: Context, fn: () => Promise<void>) {
        const userId = ctx.from?.id;
        if (!userId) {
            await replySafe(ctx, '❌ Telegram user not found.');
            return;
        }
        const acquired = await this.lockService.tryAcquire(userId);
        if (!acquired) {
            if (ctx.callbackQuery) {
                await ackNow(ctx);
            }
            await replySafe(ctx, '⏳ Iltimos kuting…');
            return;
        }
        try {
            await fn();
        } finally {
            await this.lockService.release(userId);
        }
    }
}
