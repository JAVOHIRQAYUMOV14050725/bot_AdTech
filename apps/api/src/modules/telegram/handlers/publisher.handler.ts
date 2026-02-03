// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { publisherHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { TransitionActor, UserRole } from '@/modules/domain/contracts';
import { Logger } from '@nestjs/common';
import { formatTelegramError } from '@/modules/telegram/telegram-error.util';
@Update()
export class PublisherHandler {
    private readonly logger = new Logger(PublisherHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
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

        await ctx.reply('📣 Send channel username or ID:');
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

        if (fsm.state === TelegramState.PUB_ADD_CHANNEL) {
            await this.fsm.transition(
                userId,
                TelegramState.PUB_DASHBOARD,
                { channel: text },
            );

            return ctx.reply(`🔍 Channel received: ${text}`);
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

            await this.settleAdDeal.execute({
                adDealId,
                actor: TransitionActor.system,
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
