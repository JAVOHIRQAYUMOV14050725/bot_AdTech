// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramFlow, TelegramFlowStep } from '../../application/telegram/telegram-fsm.types';
import { addChannelOptions, cancelFlowKeyboard, publisherHome, verifyPrivateChannelKeyboard } from '../keyboards';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractTelegramErrorMeta, mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { formatTelegramBotUsernameMention } from '@/common/utils/telegram-bot-username.util';
import { answerCbQuerySafe, replySafe, resolveTelegramLocale, startTelegramProgress } from '@/modules/telegram/telegram-safe-text.util';
import { TelegramUserLockService } from '@/modules/telegram/telegram-user-lock.service';
import { resolveTelegramCorrelationId } from '@/modules/telegram/telegram-context.util';
@Update()
export class PublisherHandler {
    private readonly logger = new Logger(PublisherHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly backendClient: TelegramBackendClient,
        private readonly configService: ConfigService,
        private readonly lockService: TelegramUserLockService,
    ) { }

    @Action('ROLE_PUBLISHER')
    async enter(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
                    const context = await this.ensurePublisher(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.set(
                        userId,
                        'publisher',
                        TelegramFlow.NONE,
                        TelegramFlowStep.NONE,
                    );
                    await progress.finish(
                        `📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
                        publisherHome,
                    );
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message);
                }
            });
        });
    }

    @Action('PUB_ADD_CHANNEL')
    async addChannel(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
                    const context = await this.ensurePublisher(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.PUBLISHER_ONBOARDING,
                        TelegramFlowStep.NONE,
                    );
                    await progress.finish(
                        '📣 Add a channel\n\nChoose how you want to onboard your channel:',
                        addChannelOptions,
                    );
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message);
                }
            });
        });
    }

    @Action('PUB_ADD_CHANNEL_PUBLIC')
    async addChannelPublic(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
                    const context = await this.ensurePublisher(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }
                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.PUBLISHER_ONBOARDING,
                        TelegramFlowStep.PUB_ADD_CHANNEL_PUBLIC,
                    );
                    await progress.finish('🔓 Send your channel @username or public t.me link:', cancelFlowKeyboard);
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message);
                }
            });
        });
    }

    @Action('PUB_ADD_CHANNEL_PRIVATE')
    async addChannelPrivate(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
                    const context = await this.ensurePublisher(ctx);
                    if (!context) {
                        await progress.finish('❌ Telegram user not found.');
                        return;
                    }

                    await this.fsm.startFlow(
                        userId,
                        TelegramFlow.PUBLISHER_ONBOARDING,
                        TelegramFlowStep.PUB_ADD_CHANNEL_PRIVATE,
                    );

                    const botMention = formatTelegramBotUsernameMention(
                        this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
                    );
                    await progress.finish(
                        '🔒 Your channel has no username.\n\n' +
                        `Please add ${botMention} as an ADMIN to your channel, then press "Verify Channel".`,
                        verifyPrivateChannelKeyboard,
                    );
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message);
                }
            });
        });
    }

    @Action('PUB_VERIFY_PRIVATE_CHANNEL')
    async verifyPrivateChannel(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
                let context;
                try {
                    context = await this.ensurePublisher(ctx);
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message, verifyPrivateChannelKeyboard);
                    return;
                }
                if (!context) {
                    await progress.finish('❌ Telegram user not found.', verifyPrivateChannelKeyboard);
                    return;
                }

                try {
                    const response = await this.backendClient.verifyPublisherPrivateChannel({
                        publisherId: context.user.id,
                        telegramUserId: userId.toString(),
                    });

                    if (!response.ok) {
                        this.logger.warn({
                            event: 'channel_verification_failed',
                            userId: context.user.id,
                            reason: response.message,
                        });
                    }

                    await progress.finish(response.message, verifyPrivateChannelKeyboard);
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                    this.logger.error({
                        event: 'telegram_verify_private_channel_failed',
                        userId,
                        code,
                        correlationId: errorCorrelationId,
                        error: message,
                    });
                    await progress.finish(message, verifyPrivateChannelKeyboard);
                }
            });
        });
    }

    @Action('CANCEL_FLOW')
    async cancelFlow(@Ctx() ctx: Context) {
        await answerCbQuerySafe(ctx);
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
        const fsmSnapshot = await this.fsm.get(userId);
        if (fsmSnapshot.role !== 'publisher') {
            return;
        }
        await this.withUserLock(ctx, async () => {
            const correlationId = resolveTelegramCorrelationId(ctx);
            await this.backendClient.runWithCorrelationId(correlationId, async () => {
                const progress = await startTelegramProgress(ctx);
                let context;
                try {
                    context = await this.ensurePublisher(ctx);
                } catch (err) {
                    const message = mapBackendErrorToTelegramMessage(err, locale);
                    await progress.finish(message);
                    return;
                }
                if (!context) {
                    await progress.finish('❌ Telegram user not found.');
                    return;
                }
                const fsm = context.fsm;

                const acceptMatch = text.match(/^\/(accept_addeal)\s+(\S+)/);
                if (acceptMatch) {
                    const adDealId = acceptMatch[2];
                    try {
                        const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

                        if (adDeal.adDeal.publisherId !== context.user.id) {
                            await progress.finish('❌ AdDeal not found for publisher');
                            return;
                        }

                        await this.backendClient.acceptAdDeal(adDealId);

                        await progress.finish(
                            `✅ AdDeal accepted\nID: ${adDealId}\n\n` +
                            `Advertiser must confirm before you can submit proof:\n` +
                            `• Advertiser: /confirm_addeal ${adDealId}`,
                        );
                        return;
                    } catch (err) {
                        const message = mapBackendErrorToTelegramMessage(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        this.logger.error({
                            event: 'telegram_accept_failed',
                            adDealId,
                            userId,
                            role: fsm.role,
                            flow: fsm.flow,
                            step: fsm.step,
                            error: message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(message);
                        return;
                    }
                }

                const declineMatch = text.match(/^\/(decline_addeal)\s+(\S+)/);
                if (declineMatch) {
                    const adDealId = declineMatch[2];
                    try {
                        const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

                        if (adDeal.adDeal.publisherId !== context.user.id) {
                            await progress.finish('❌ AdDeal not found for publisher');
                            return;
                        }

                        await this.backendClient.declineAdDeal(adDealId);

                        await progress.finish(`🚫 AdDeal declined\nID: ${adDealId}`);
                        return;
                    } catch (err) {
                        const message = mapBackendErrorToTelegramMessage(err, locale);
                        const { code, correlationId: errorCorrelationId } = extractTelegramErrorMeta(err);
                        this.logger.error({
                            event: 'telegram_decline_failed',
                            adDealId,
                            userId,
                            role: fsm.role,
                            flow: fsm.flow,
                            step: fsm.step,
                            error: message,
                            code,
                            correlationId: errorCorrelationId,
                        });
                        await progress.finish(message);
                        return;
                    }
                }

                const submitMatch = text.match(
                    /^\/(submit_proof)\s+(\S+)(?:\s+(.+))?$/,
                );
                if (submitMatch) {
                    const adDealId = submitMatch[2];
                    const proofText = submitMatch[3];

                    if (!proofText) {
                        await this.fsm.startFlow(
                            userId,
                            TelegramFlow.PUBLISHER_ONBOARDING,
                            TelegramFlowStep.PUB_ADDEAL_PROOF,
                            { adDealId },
                        );
                        await progress.finish('🧾 Send proof details:', cancelFlowKeyboard);
                        return;
                    }

                    await this.handleProofSubmission(ctx, adDealId, proofText, progress);
                    return;
                }

                if (
                    fsm.flow === TelegramFlow.PUBLISHER_ONBOARDING
                    && fsm.step === TelegramFlowStep.PUB_ADD_CHANNEL_PUBLIC
                ) {
                    await this.fsm.clearFlow(userId);
                    await this.handlePublicChannelInput(ctx, context.user.id, text, progress);
                    return;
                }

                if (fsm.flow === TelegramFlow.PUBLISHER_ONBOARDING && fsm.step === TelegramFlowStep.PUB_ADDEAL_PROOF) {
                    const adDealId = fsm.payload.adDealId;
                    if (!adDealId) {
                        await this.fsm.clearFlow(userId);
                        await progress.finish(
                            '⚠️ Session expired. Please restart proof submission with /submit_proof.',
                            cancelFlowKeyboard,
                        );
                        return;
                    }
                    await this.fsm.clearFlow(userId);
                    await this.handleProofSubmission(ctx, adDealId, text, progress);
                    return;
                }

                if (fsm.flow === TelegramFlow.NONE) {
                    await progress.finish('ℹ️ Session expired. Use /start to choose your role.');
                    return;
                }

                await progress.finish('❌ Iltimos, ko‘rsatilgan qadamlardan foydalaning.', cancelFlowKeyboard);
            });
        });
    }

    private async handleProofSubmission(
        ctx: Context,
        adDealId: string,
        proofText: string,
        progressParam?: Awaited<ReturnType<typeof startTelegramProgress>>,
    ) {
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        const progress = progressParam ?? await startTelegramProgress(ctx);
        try {
            const publisher = await this.ensurePublisher(ctx);
            if (!publisher) {
                await progress.finish('❌ Telegram user not found.');
                return;
            }

            const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

            if (adDeal.adDeal.publisherId !== publisher.user.id) {
                return replySafe(ctx, '❌ AdDeal not found for publisher');
            }

            await this.backendClient.submitProof({
                adDealId,
                proofText,
            });

            this.logger.log({
                event: 'proof_submitted',
                adDealId,
                publisherId: publisher.user.id,
            });

            await this.backendClient.settleAdDeal(adDealId);

            this.logger.log({
                event: 'settlement_completed',
                adDealId,
                publisherId: publisher.user.id,
            });

            await progress.finish(`✅ Proof submitted & settled\nID: ${adDealId}`);
            return;
        } catch (err) {
            const message = mapBackendErrorToTelegramMessage(err, locale);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_proof_failed',
                adDealId,
                userId,
                role: fsm.role,
                flow: fsm.flow,
                step: fsm.step,
                error: message,
                code,
                correlationId,
            });
            await progress.finish(message);
            return;
        }
    }

    private async handlePublicChannelInput(
        ctx: Context,
        publisherId: string,
        value: string,
        progressParam?: Awaited<ReturnType<typeof startTelegramProgress>>,
    ) {
        const locale = resolveTelegramLocale(ctx.from?.language_code);
        const progress = progressParam ?? await startTelegramProgress(ctx);
        try {
            const response = await this.backendClient.verifyPublisherChannel({
                publisherId,
                telegramUserId: ctx.from!.id.toString(),
                identifier: value,
            });
            await progress.finish(response.message);
            return;
        } catch (err) {
            const message = mapBackendErrorToTelegramMessage(err, locale);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_public_channel_verify_failed',
                publisherId,
                code,
                correlationId,
                error: message,
            });
            await progress.finish(message);
            return;
        }
    }

    private async ensurePublisher(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            return null;
        }

        const userResponse = await this.backendClient.ensurePublisher({
            telegramId: userId.toString(),
        });

        const user = userResponse.user;

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'publisher'
                ? await this.fsm.updateRole(userId, 'publisher')
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