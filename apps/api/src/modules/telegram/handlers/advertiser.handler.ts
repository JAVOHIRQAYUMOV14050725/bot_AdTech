import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAdDealUseCase } from '@/modules/application/addeal/create-addeal.usecase';
import { FundAdDealUseCase } from '@/modules/application/addeal/fund-addeal.usecase';
import { LockEscrowUseCase } from '@/modules/application/addeal/lock-escrow.usecase';
import { OpenDisputeUseCase } from '@/modules/application/addeal/open-dispute.usecase';
import { RefundAdDealUseCase } from '@/modules/application/addeal/refund-addeal.usecase';
import { PaymentsService } from '@/modules/payments/payments.service';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { TransitionActor } from '@/modules/domain/contracts';
import { randomUUID } from 'crypto';

@Update()
export class AdvertiserHandler {
    private readonly logger = new Logger(AdvertiserHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly createAdDeal: CreateAdDealUseCase,
        private readonly fundAdDeal: FundAdDealUseCase,
        private readonly lockEscrow: LockEscrowUseCase,
        private readonly openDispute: OpenDisputeUseCase,
        private readonly refundAdDeal: RefundAdDealUseCase,
        private readonly paymentsService: PaymentsService,
    ) { }

    @Action('ROLE_ADVERTISER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const user = await this.assertRole(ctx, UserRole.advertiser, {
            createIfMissing: true,
        });
        if (!user) {
            return;
        }

        await this.fsm.set(userId, TelegramState.ADV_DASHBOARD);

        this.logger.log({
            event: 'telegram_role_selected',
            role: UserRole.advertiser,
            userId: user.id,
            telegramId: user.telegramId.toString(),
        });

        await ctx.reply(
            `🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
            advertiserHome,
        );
    }

    @Action('ADD_BALANCE')
    async addBalance(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.advertiser);
        if (!user) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADD_BALANCE_AMOUNT,
        );

        this.logger.log({
            event: 'telegram_add_balance_started',
            userId: user.id,
            telegramId: user.telegramId.toString(),
            state: fsm.state,
        });

        await ctx.reply('💰 Enter amount (USD):');
    }

    @Action('CREATE_ADDEAL')
    async beginCreateAdDeal(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.advertiser);
        if (!user) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADDEAL_PUBLISHER,
        );

        this.logger.log({
            event: 'telegram_addeal_create_started',
            userId: user.id,
            telegramId: user.telegramId.toString(),
            state: fsm.state,
        });

        await ctx.reply('🤝 Enter publisher Telegram ID:');
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);
        const user = await this.assertRole(ctx, UserRole.advertiser);
        if (!user) {
            return;
        }
        const commandMatch = text.match(/^\/(fund_addeal|lock_addeal)\s+(\S+)/);
        if (commandMatch) {
            const [, command, adDealId] = commandMatch;
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.advertiserId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for advertiser');
                }

                if (command === 'fund_addeal') {
                    await this.fundAdDeal.execute({
                        adDealId,
                        provider: 'wallet_balance',
                        providerReference: `telegram:${userId}:${adDealId}`,
                        amount: adDeal.amount.toFixed(2),
                        verified: true,
                        actor: TransitionActor.system,
                    });
                    this.logger.log({
                        event: 'telegram_addeal_funded',
                        adDealId,
                        userId: user.id,
                        telegramId: user.telegramId.toString(),
                    });
                    return ctx.reply(`✅ AdDeal funded\nID: ${adDealId}`);
                }

                if (command === 'lock_addeal') {
                    await this.lockEscrow.execute({
                        adDealId,
                        actor: TransitionActor.advertiser,
                    });
                    this.logger.log({
                        event: 'telegram_addeal_escrow_locked',
                        adDealId,
                        userId: user.id,
                        telegramId: user.telegramId.toString(),
                    });
                    return ctx.reply(`🔒 Escrow locked\nID: ${adDealId}`);
                }
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_addeal_command_failed',
                    command,
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
                if (!adDeal || adDeal.advertiserId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for advertiser');
                }

                await this.openDispute.execute({
                    adDealId,
                    openedBy: user.id,
                    reason,
                    actor: TransitionActor.advertiser,
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

        const refundMatch = text.match(/^\/refund_addeal\s+(\S+)/);
        if (refundMatch) {
            const adDealId = refundMatch[1];
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });
                if (!adDeal || adDeal.advertiserId !== user.id) {
                    return ctx.reply('❌ AdDeal not found for advertiser');
                }

                await this.refundAdDeal.execute({
                    adDealId,
                    actor: TransitionActor.advertiser,
                });

                this.logger.log({
                    event: 'telegram_addeal_refunded',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                });

                return ctx.reply(`💸 AdDeal refunded\nID: ${adDealId}`);
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_refund_failed',
                    adDealId,
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        if (fsm.state === TelegramState.ADV_ADD_BALANCE_AMOUNT) {
            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return ctx.reply('❌ Invalid amount');
            }
            const amount = new Prisma.Decimal(amountText);
            if (amount.lte(0)) {
                return ctx.reply('❌ Invalid amount');
            }

            try {
                const idempotencyKey = `telegram:deposit:${userId}:${randomUUID()}`;
                await this.paymentsService.deposit(
                    user.id,
                    amount,
                    idempotencyKey,
                );

                const wallet = await this.prisma.wallet.findUnique({
                    where: { userId: user.id },
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                    { amount: amount.toFixed(2) },
                );

                const balanceText = wallet?.balance
                    ? wallet.balance.toFixed(2)
                    : amount.toFixed(2);
                this.logger.log({
                    event: 'telegram_deposit_completed',
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    amount: amount.toFixed(2),
                    balance: balanceText,
                });
                return ctx.reply(
                    `✅ Deposit completed\nAmount: $${amount.toFixed(2)}\nBalance: $${balanceText}`,
                );
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_deposit_failed',
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_PUBLISHER) {
            const publisherTelegramId = this.parseTelegramId(text);
            if (!publisherTelegramId) {
                return ctx.reply('❌ Invalid Telegram ID');
            }

            const publisher = await this.prisma.user.findUnique({
                where: { telegramId: publisherTelegramId },
            });

            if (!publisher) {
                return ctx.reply('❌ Publisher not found');
            }

            await this.fsm.transition(
                userId,
                TelegramState.ADV_ADDEAL_AMOUNT,
                { publisherId: publisher.id },
            );

            return ctx.reply('💵 Enter deal amount (USD):');
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_AMOUNT) {
            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return ctx.reply('❌ Invalid amount');
            }

            if (new Prisma.Decimal(amountText).lte(0)) {
                return ctx.reply('❌ Invalid amount');
            }

            try {
                const wallet = await this.prisma.wallet.findUnique({
                    where: { userId: user.id },
                });

                const requiredAmount = new Prisma.Decimal(amountText);
                if (!wallet || wallet.balance.lt(requiredAmount)) {
                    return ctx.reply(
                        `❌ Insufficient balance. Deposit at least $${requiredAmount.toFixed(2)} before creating a deal.`,
                    );
                }

                const adDeal = await this.createAdDeal.execute({
                    advertiserId: user.id,
                    publisherId: fsm.payload.publisherId,
                    amount: amountText,
                });

                await this.fundAdDeal.execute({
                    adDealId: adDeal.id,
                    provider: 'wallet_balance',
                    providerReference: `telegram:${userId}:${adDeal.id}`,
                    amount: amountText,
                    verified: true,
                    actor: TransitionActor.system,
                });

                await this.lockEscrow.execute({
                    adDealId: adDeal.id,
                    actor: TransitionActor.advertiser,
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                );

                this.logger.log({
                    event: 'telegram_addeal_created',
                    adDealId: adDeal.id,
                    advertiserId: user.id,
                    publisherId: adDeal.publisherId,
                    amount: adDeal.amount.toFixed(2),
                });

                return ctx.reply(
                    `✅ AdDeal created & escrow locked\nID: ${adDeal.id}\n\n` +
                    `Next steps:\n` +
                    `• Publisher: /accept_addeal ${adDeal.id}\n` +
                    `• Publisher: /submit_proof ${adDeal.id} <proof>`,
                );
            } catch (err) {
                const message = this.formatError(err);
                this.logger.error({
                    event: 'telegram_addeal_create_failed',
                    userId: user.id,
                    telegramId: user.telegramId.toString(),
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        return undefined;
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
                        balance: new Prisma.Decimal(0),
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

    private parseTelegramId(value: string): bigint | null {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed)) {
            return null;
        }
        try {
            return BigInt(trimmed);
        } catch {
            return null;
        }
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
