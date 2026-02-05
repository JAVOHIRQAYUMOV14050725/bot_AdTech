// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { addChannelOptions, publisherHome, verifyPrivateChannelKeyboard } from '../keyboards';
import { Logger } from '@nestjs/common';
import { telegramSafeErrorMessageWithCorrelation } from '@/modules/telegram/telegram-error.util';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
@Update()
export class PublisherHandler {
    private readonly logger = new Logger(PublisherHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly backendClient: TelegramBackendClient,
    ) { }

    @Action('ROLE_PUBLISHER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
            return;
        }

        await this.fsm.set(
            userId,
            'publisher',
            TelegramState.PUB_DASHBOARD,
        );

        await ctx.reply(
            `📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
            publisherHome,
        );
    }

    @Action('PUB_ADD_CHANNEL')
    async addChannel(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.PUB_ADD_CHANNEL,
        );

        await ctx.reply(
            '📣 Add a channel\n\nChoose how you want to onboard your channel:',
            addChannelOptions,
        );
    }

    @Action('PUB_ADD_CHANNEL_PUBLIC')
    async addChannelPublic(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.PUB_ADD_CHANNEL_PUBLIC,
        );

        await ctx.reply('🔓 Send your channel @username or public t.me link:');
    }

    @Action('PUB_ADD_CHANNEL_PRIVATE')
    async addChannelPrivate(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.PUB_ADD_CHANNEL_PRIVATE,
        );

        await ctx.reply(
            '🔒 Your channel has no username.\n\n' +
            'Please add @AdTechBot as an ADMIN to your channel, then press "Verify Channel".',
            verifyPrivateChannelKeyboard,
        );
    }

    @Action('PUB_VERIFY_PRIVATE_CHANNEL')
    async verifyPrivateChannel(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
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

            return ctx.reply(response.message, verifyPrivateChannelKeyboard);
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            return ctx.reply(`❌ ${message}`, verifyPrivateChannelKeyboard);
        }
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const context = await this.ensurePublisher(ctx);
        if (!context) {
            return;
        }
        const fsm = context.fsm;

        const acceptMatch = text.match(/^\/(accept_addeal)\s+(\S+)/);
        if (acceptMatch) {
            const adDealId = acceptMatch[2];
            try {
                const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

                if (adDeal.adDeal.publisherId !== context.user.id) {
                    return ctx.reply('❌ AdDeal not found for publisher');
                }

                await this.backendClient.acceptAdDeal(adDealId);

                return ctx.reply(`✅ AdDeal accepted\nID: ${adDealId}`);
            } catch (err) {
                const message = telegramSafeErrorMessageWithCorrelation(err);
                this.logger.error({
                    event: 'telegram_accept_failed',
                    adDealId,
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        const submitMatch = text.match(
            /^\/(submit_proof)\s+(\S+)(?:\s+(.+))?$/,
        );
        if (submitMatch) {
            const adDealId = submitMatch[2];
            const proofText = submitMatch[3];

            if (!proofText) {
                await this.fsm.transition(
                    userId,
                    TelegramState.PUB_ADDEAL_PROOF,
                    { adDealId },
                );
                return ctx.reply('🧾 Send proof details:');
            }

            return this.handleProofSubmission(ctx, adDealId, proofText);
        }

        if (
            fsm.state === TelegramState.PUB_ADD_CHANNEL_PUBLIC
            || fsm.state === TelegramState.PUB_ADD_CHANNEL
        ) {
            await this.fsm.transition(
                userId,
                TelegramState.PUB_DASHBOARD,
                { channel: text },
            );

            return this.handlePublicChannelInput(ctx, context.user.id, text);
        }

        if (fsm.state === TelegramState.PUB_ADDEAL_PROOF) {
            const adDealId = fsm.payload.adDealId;
            if (!adDealId) {
                await this.fsm.transition(
                    userId,
                    TelegramState.PUB_DASHBOARD,
                );
                return ctx.reply(
                    '⚠️ Session expired. Please restart proof submission with /submit_proof.',
                );
            }
            await this.fsm.transition(
                userId,
                TelegramState.PUB_DASHBOARD,
            );
            return this.handleProofSubmission(ctx, adDealId, text);
        }

        if (
            fsm.state === TelegramState.IDLE
            || fsm.state === TelegramState.SELECT_ROLE
        ) {
            await ctx.reply('ℹ️ Session expired. Use /start to choose your role.');
            return;
        }

        return undefined;
    }

    private async handleProofSubmission(
        ctx: Context,
        adDealId: string,
        proofText: string,
    ) {
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);

        try {
            const publisher = await this.ensurePublisher(ctx);
            if (!publisher) {
                return;
            }

            const adDeal = await this.backendClient.lookupAdDeal({ adDealId });

            if (adDeal.adDeal.publisherId !== publisher.user.id) {
                return ctx.reply('❌ AdDeal not found for publisher');
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

            return ctx.reply(`✅ Proof submitted & settled\nID: ${adDealId}`);
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            this.logger.error({
                event: 'telegram_proof_failed',
                adDealId,
                userId,
                role: fsm.role,
                state: fsm.state,
                error: message,
            });
            return ctx.reply(`❌ ${message}`);
        }
    }

    private async handlePublicChannelInput(
        ctx: Context,
        publisherId: string,
        value: string,
    ) {
        try {
            const response = await this.backendClient.verifyPublisherChannel({
                publisherId,
                telegramUserId: ctx.from!.id.toString(),
                identifier: value,
            });
            return ctx.reply(response.message);
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            return ctx.reply(`❌ ${message}`);
        }
    }

    private async ensurePublisher(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Telegram user not found.');
            return null;
        }

        let userResponse;
        try {
            userResponse = await this.backendClient.ensurePublisher({
                telegramId: userId.toString(),
            });
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
            return null;
        }

        const user = userResponse.user;

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'publisher'
                ? await this.fsm.updateRole(userId, 'publisher')
                : fsm;

        return { user, fsm: syncedFsm };
    }
}
