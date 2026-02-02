// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { publisherHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { OpenDisputeUseCase } from '@/modules/application/addeal/open-dispute.usecase';
import { TransitionActor } from '@/modules/domain/contracts';
import { Logger } from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
@Update()
export class PublisherHandler {
    private readonly logger = new Logger(PublisherHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly acceptDeal: AcceptDealUseCase,
        private readonly submitProof: SubmitProofUseCase,
        private readonly openDispute: OpenDisputeUseCase,
    ) { }

    @Action('ROLE_PUBLISHER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const user = await this.assertRole(ctx, UserRole.publisher, {
            createIfMissing: true,
        });
        if (!user) {
            return;
        }

        await this.fsm.set(userId, TelegramState.PUB_DASHBOARD);

        this.logger.log({
            event: 'telegram_role_selected',
            role: UserRole.publisher,
            userId: user.id,
            telegramId: user.telegramId.toString(),
        });

        await ctx.reply(
            `📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
            publisherHome,
        );
    }

    @Action('PUB_ADD_CHANNEL')
    async addChannel(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.publisher);
        if (!user) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.PUB_ADD_CHANNEL,
        );

        this.logger.log({
            event: 'telegram_channel_add_started',
            userId: user.id,
            telegramId: user.telegramId.toString(),
            state: fsm.state,
        });

        await ctx.reply('📣 Send channel username or ID:');
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.publisher);
        if (!user) {
            return;
        }

        const acceptMatch = text.match(/^\/(accept_addeal)\s+(\S+)/);
        if (acceptMatch) {
            const adDealId = acceptMatch[2];
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.publisherId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for publisher');
                }

                await this.acceptDeal.execute({
                    adDealId,
                    actor: TransitionActor.publisher,
                });

                this.logger.log({
                    event: 'telegram_addeal_accepted',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                });

                return ctx.reply(`✅ AdDeal accepted\nID: ${adDealId}`);
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_accept_failed',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        const disputeMatch = text.match(/^\/open_dispute\s+(\S+)(?:\s+(.+))?$/);
        if (disputeMatch) {
            const adDealId = disputeMatch[1];
            const reason = disputeMatch[2]?.trim();
            if (!reason) {
                return ctx.reply('Usage: /open_dispute <adDealId> <reason>');
            }

            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.publisherId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for publisher');
                }

                await this.openDispute.execute({
                    adDealId,
                    openedBy: user.id,
                    reason,
                    actor: TransitionActor.publisher,
                });

                this.logger.log({
                    event: 'telegram_addeal_disputed',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    reason,
                });

                return ctx.reply(`⚠️ Dispute opened\nID: ${adDealId}`);
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_dispute_failed',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        const refuseMatch = text.match(/^\/refuse_addeal\s+(\S+)(?:\s+(.+))?$/);
        if (refuseMatch) {
            const adDealId = refuseMatch[1];
            const reason = refuseMatch[2]?.trim() ?? 'publisher_refused';
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.publisherId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for publisher');
                }

                await this.openDispute.execute({
                    adDealId,
                    openedBy: user.id,
                    reason: `publisher_refused:${reason}`,
                    actor: TransitionActor.publisher,
                });

                this.logger.log({
                    event: 'telegram_addeal_refused',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    reason,
                });

                return ctx.reply(`🚫 Deal refused, dispute opened\nID: ${adDealId}`);
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_refuse_failed',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
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
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.publisher);
        if (!user) {
            return;
        }

        try {
            const adDeal = await this.prisma.adDeal.findUnique({
                where: { id: adDealId },
            });

            if (!adDeal || adDeal.publisherId !== user.id) {
                return ctx.reply('❌ AdDeal not found for publisher');
            }

            await this.submitProof.execute({
                adDealId,
                proofPayload: { text: proofText },
                actor: TransitionActor.publisher,
            });

            this.logger.log({
                event: 'telegram_proof_submitted',
                adDealId,
                userId: user.id,
                telegramId: user.telegramId.toString(),
            });

            return ctx.reply(
                `✅ Proof submitted\nID: ${adDealId}\n\n` +
                `Status: awaiting review.`,
            );
        } catch (err) {
            const message = this.formatError(err);
            this.logger.error({
                event: 'telegram_proof_failed',
                adDealId,
                userId: user.id,
                telegramId: user.telegramId.toString(),
                state: fsm.state,
                error: message,
            });
            return ctx.reply(`❌ ${message}`);
        }
    }

    private async assertRole(
        ctx: Context,
        role: UserRole,
        options?: { createIfMissing?: boolean },
    ): Promise<User | null> {
        const telegramId = ctx.from?.id;
        if (!telegramId) {
            await ctx.reply('❌ Telegram identity missing');
            return null;
        }

        const telegramIdBigInt = BigInt(telegramId);
        let user = await this.prisma.user.findUnique({
            where: { telegramId: telegramIdBigInt },
        });

        if (!user && options?.createIfMissing) {
            user = await this.prisma.$transaction(async (tx) => {
                const created = await tx.user.create({
                    data: {
                        telegramId: telegramIdBigInt,
                        username: ctx.from?.username ?? null,
                        role,
                        status: UserStatus.active,
                    },
                });

                await tx.wallet.create({
                    data: {
                        userId: created.id,
                        balance: 0,
                        currency: 'USD',
                    },
                });

                await tx.userAuditLog.create({
                    data: {
                        userId: created.id,
                        action: 'telegram_user_created',
                        metadata: {
                            role,
                            telegramId: telegramIdBigInt.toString(),
                        },
                    },
                });

                return created;
            });

            this.logger.log({
                event: 'telegram_user_created',
                userId: user.id,
                role,
                telegramId: user.telegramId.toString(),
            });
        }

        if (!user) {
            await ctx.reply('❌ Account not found. Use /start to begin.');
            return null;
        }

        if (user.status !== UserStatus.active) {
            await ctx.reply('⛔ Your account is not active. Contact support.');
            return null;
        }

        if (user.role !== role) {
            this.logger.warn({
                event: 'telegram_role_mismatch',
                requiredRole: role,
                userId: user.id,
                telegramId: user.telegramId.toString(),
                actualRole: user.role,
            });
            await ctx.reply(`⛔ This action requires ${role} role.`);
            return null;
        }

        return user;
    }

    private formatError(err: unknown) {
        if (err instanceof Error) {
            return err.message;
        }
        if (typeof err === 'string') {
            return err;
        }
        try {
            return JSON.stringify(err);
        } catch {
            return 'Unknown error';
        }
    }
}
