// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { addChannelOptions, publisherHome, verifyPrivateChannelKeyboard } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { TransitionActor, UserRole } from '@/modules/domain/contracts';
import { Logger } from '@nestjs/common';
import { formatTelegramError } from '@/modules/telegram/telegram-error.util';
import { ChannelsService } from '@/modules/channels/channels.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { ChannelStatus } from '@prisma/client';
@Update()
export class PublisherHandler {
    private readonly logger = new Logger(PublisherHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly channelsService: ChannelsService,
        private readonly telegramService: TelegramService,
        private readonly acceptDeal: AcceptDealUseCase,
        private readonly submitProof: SubmitProofUseCase,
        private readonly settleAdDeal: SettleAdDealUseCase,
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

        this.logger.log({
            event: 'channel_verification_started',
            userId: context.user.id,
            flow: 'private_no_username',
        });

        const recentSignals = await this.prisma.telegramChannelSignal.findMany({
            orderBy: { receivedAt: 'desc' },
            take: 5,
        });

        if (recentSignals.length === 0) {
            this.logger.warn({
                event: 'channel_verification_failed',
                userId: context.user.id,
                reason: 'NO_CHANNEL_SIGNAL',
            });
            return ctx.reply(
                '⚠️ We could not detect your channel yet.\n\n' +
                'Please add @AdTechBot as ADMIN and post a message in the channel, then tap "Verify Channel" again.',
                verifyPrivateChannelKeyboard,
            );
        }

        for (const signal of recentSignals) {
            const channelId = signal.telegramChannelId.toString();
            const botAdmin = await this.telegramService.checkBotAdmin(channelId);
            if (!botAdmin.isAdmin) {
                continue;
            }

            this.logger.log({
                event: 'channel_bot_admin_confirmed',
                userId: context.user.id,
                telegramChannelId: channelId,
                flow: 'private_no_username',
            });

            const userAdmin = await this.telegramService.checkUserAdmin(channelId, userId);
            if (!userAdmin.isAdmin) {
                continue;
            }

            this.logger.log({
                event: 'channel_identity_resolved',
                userId: context.user.id,
                telegramChannelId: channelId,
                flow: 'private_no_username',
            });

            return this.registerChannelFromSignal(ctx, context.user.id, signal);
        }

        this.logger.warn({
            event: 'channel_verification_failed',
            userId: context.user.id,
            reason: 'BOT_OR_USER_NOT_ADMIN',
        });

        return ctx.reply(
            '❌ Verification failed.\n\n' +
            'Make sure @AdTechBot is an ADMIN and you are an ADMIN/OWNER of the channel.',
            verifyPrivateChannelKeyboard,
        );
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
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.publisherId !== context.user.id) {
                    return ctx.reply('❌ AdDeal not found for publisher');
                }

                await this.acceptDeal.execute({
                    adDealId,
                    actor: TransitionActor.publisher,
                });

                return ctx.reply(`✅ AdDeal accepted\nID: ${adDealId}`);
            } catch (err) {
                const message = formatTelegramError(err);
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

            const adDeal = await this.prisma.adDeal.findUnique({
                where: { id: adDealId },
            });

            if (!adDeal || adDeal.publisherId !== publisher.user.id) {
                return ctx.reply('❌ AdDeal not found for publisher');
            }

            await this.submitProof.execute({
                adDealId,
                proofPayload: { text: proofText },
                actor: TransitionActor.publisher,
            });

            this.logger.log({
                event: 'proof_submitted',
                adDealId,
                publisherId: publisher.user.id,
            });

            await this.settleAdDeal.execute({
                adDealId,
                actor: TransitionActor.system,
            });

            this.logger.log({
                event: 'settlement_completed',
                adDealId,
                publisherId: publisher.user.id,
            });

            return ctx.reply(`✅ Proof submitted & settled\nID: ${adDealId}`);
        } catch (err) {
            const message = formatTelegramError(err);
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

    private parseChannelIdentifier(value: string) {
        const usernameRegex = /^(?=.{5,32}$)(?=.*[A-Za-z])[A-Za-z0-9_]+$/;
        if (!value) {
            return null;
        }

        if (value.startsWith('@')) {
            const username = value.slice(1);
            if (!usernameRegex.test(username)) {
                return { error: 'That @username does not look valid.' };
            }
            return { username };
        }

        const linkMatch = value.match(/^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i);
        if (linkMatch) {
            const path = linkMatch[1];
            const lowered = path.toLowerCase();
            if (lowered === 'c' || lowered === 'joinchat' || path.startsWith('+')) {
                return {
                    error: 'Invite links are not supported. Please send a public @username or t.me/username.',
                };
            }
            if (!usernameRegex.test(path)) {
                return { error: 'That t.me link does not look like a public username.' };
            }
            return { username: path };
        }

        if (usernameRegex.test(value)) {
            return { username: value };
        }

        return null;
    }

    private async handlePublicChannelInput(
        ctx: Context,
        publisherId: string,
        value: string,
    ) {
        const parsed = this.parseChannelIdentifier(value.trim());
        if (!parsed) {
            return ctx.reply('❌ Please send a valid @username or public t.me link.');
        }
        if ('error' in parsed) {
            return ctx.reply(`❌ ${parsed.error}`);
        }

        this.logger.log({
            event: 'channel_verification_started',
            userId: publisherId,
            flow: 'public_username',
        });

        const resolved = await this.telegramService.resolvePublicChannel(parsed.username);
        if (!resolved.ok) {
            this.logger.warn({
                event: 'channel_verification_failed',
                userId: publisherId,
                reason: resolved.reason,
                flow: 'public_username',
            });
            return ctx.reply(
                '❌ We could not find that channel.\n\n' +
                'Please double-check the @username and try again.',
            );
        }

        const botAdmin = await this.telegramService.checkBotAdmin(resolved.telegramChannelId);
        if (!botAdmin.isAdmin) {
            this.logger.warn({
                event: 'channel_verification_failed',
                userId: publisherId,
                reason: botAdmin.reason,
                flow: 'public_username',
            });
            return ctx.reply(
                '⚠️ Please add @AdTechBot as an ADMIN to your channel, then try again.',
            );
        }

        this.logger.log({
            event: 'channel_bot_admin_confirmed',
            userId: publisherId,
            telegramChannelId: resolved.telegramChannelId,
            flow: 'public_username',
        });

        const userAdmin = await this.telegramService.checkUserAdmin(
            resolved.telegramChannelId,
            ctx.from!.id,
        );
        if (!userAdmin.isAdmin) {
            this.logger.warn({
                event: 'channel_verification_failed',
                userId: publisherId,
                reason: userAdmin.reason,
                flow: 'public_username',
            });
            return ctx.reply(
                '❌ Ownership check failed. You must be an ADMIN/OWNER of this channel.',
            );
        }

        this.logger.log({
            event: 'channel_identity_resolved',
            userId: publisherId,
            telegramChannelId: resolved.telegramChannelId,
            flow: 'public_username',
        });

        return this.registerChannel({
            ctx,
            publisherId,
            telegramChannelId: resolved.telegramChannelId,
            title: resolved.title,
            username: resolved.username,
        });
    }

    private async registerChannelFromSignal(
        ctx: Context,
        publisherId: string,
        signal: { telegramChannelId: bigint; title: string | null; username: string | null },
    ) {
        return this.registerChannel({
            ctx,
            publisherId,
            telegramChannelId: signal.telegramChannelId.toString(),
            title: signal.title ?? 'Untitled Channel',
            username: signal.username ?? undefined,
        });
    }

    private async registerChannel(params: {
        ctx: Context;
        publisherId: string;
        telegramChannelId: string;
        title: string;
        username?: string;
    }) {
        const { ctx, publisherId, telegramChannelId, title, username } = params;

        const existing = await this.prisma.channel.findFirst({
            where: { telegramChannelId: BigInt(telegramChannelId) },
            include: { owner: true },
        });

        if (existing) {
            if (existing.ownerId === publisherId) {
                if (existing.status === ChannelStatus.approved) {
                    return ctx.reply('✅ This channel is already approved in your account.');
                }
                return ctx.reply('ℹ️ This channel is already registered and pending review.');
            }

            this.logger.warn({
                event: 'channel_verification_failed',
                userId: publisherId,
                reason: 'ALREADY_EXISTS',
            });

            return ctx.reply('❌ This channel is already registered by another publisher.');
        }

        try {
            const channel = await this.channelsService.createChannel(publisherId, {
                telegramChannelId,
                title,
                username,
            });

            this.logger.log({
                event: 'channel_registered',
                userId: publisherId,
                channelId: channel.id,
            });

            await this.channelsService.requestVerification(channel.id, publisherId);

            return ctx.reply(
                '✅ Channel verified and registered!\n\nYour channel is now pending approval.',
            );
        } catch (err) {
            this.logger.warn({
                event: 'channel_verification_failed',
                userId: publisherId,
                reason: err instanceof Error ? err.message : 'UNKNOWN',
            });

            return ctx.reply(
                '❌ We could not complete verification.\n\n' +
                'Please ensure @AdTechBot is ADMIN and try again.',
            );
        }
    }

    private async ensurePublisher(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Telegram user not found.');
            return null;
        }

        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(userId) },
        });

        if (!user) {
            await ctx.reply('❌ Publisher account not found.');
            return null;
        }

        if (user.role !== UserRole.publisher) {
            this.logger.warn({
                event: 'telegram_role_block',
                action: 'publisher_access',
                userId,
                role: user.role,
            });
            await ctx.reply(
                `⛔ Not allowed. Your account role is ${user.role}.`,
            );
            return null;
        }

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'publisher'
                ? await this.fsm.updateRole(userId, 'publisher')
                : fsm;

        return { user, fsm: syncedFsm };
    }
}