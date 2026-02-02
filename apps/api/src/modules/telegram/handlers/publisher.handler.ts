// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { publisherHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { TransitionActor } from '@/modules/domain/contracts';
@Update()
export class PublisherHandler {
    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly acceptDeal: AcceptDealUseCase,
        private readonly submitProof: SubmitProofUseCase,
    ) { }

    @Action('ROLE_PUBLISHER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;

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
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'publisher') {
            await ctx.reply('⛔ Not allowed yet. Switch to publisher role.');
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
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'publisher') {
            await ctx.reply('⛔ Not allowed yet. Switch to publisher role.');
            return;
        }

        const acceptMatch = text.match(/^\/(accept_addeal)\s+(\S+)/);
        if (acceptMatch) {
            const adDealId = acceptMatch[2];
            const publisher = await this.prisma.user.findUnique({
                where: { telegramId: BigInt(userId) },
            });

            if (!publisher) {
                return ctx.reply('❌ Publisher not found');
            }

            const adDeal = await this.prisma.adDeal.findUnique({
                where: { id: adDealId },
            });

            if (!adDeal || adDeal.publisherId !== publisher.id) {
                return ctx.reply('❌ AdDeal not found for publisher');
            }

            await this.acceptDeal.execute({
                adDealId,
                actor: TransitionActor.publisher,
            });

            return ctx.reply(`✅ AdDeal accepted\nID: ${adDealId}`);
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
            await this.fsm.transition(
                userId,
                TelegramState.PUB_DASHBOARD,
            );
            return this.handleProofSubmission(ctx, adDealId, text);
        }

        return undefined;
    }

    private async handleProofSubmission(
        ctx: Context,
        adDealId: string,
        proofText: string,
    ) {
        const publisher = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from!.id) },
        });

        if (!publisher) {
            return ctx.reply('❌ Publisher not found');
        }

        const adDeal = await this.prisma.adDeal.findUnique({
            where: { id: adDealId },
        });

        if (!adDeal || adDeal.publisherId !== publisher.id) {
            return ctx.reply('❌ AdDeal not found for publisher');
        }

        await this.submitProof.execute({
            adDealId,
            proofPayload: { text: proofText },
            actor: TransitionActor.publisher,
        });

        return ctx.reply(`✅ Proof submitted\nID: ${adDealId}`);
    }
}
