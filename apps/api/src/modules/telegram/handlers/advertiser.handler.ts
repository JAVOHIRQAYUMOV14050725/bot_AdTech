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
import { PaymentsService } from '@/modules/payments/payments.service';
import { Prisma } from '@prisma/client';
import { TransitionActor, UserRole } from '@/modules/domain/contracts';
import { randomUUID } from 'crypto';
import { formatTelegramError } from '@/modules/telegram/telegram-error.util';

@Update()
export class AdvertiserHandler {
    private readonly logger = new Logger(AdvertiserHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly createAdDeal: CreateAdDealUseCase,
        private readonly fundAdDeal: FundAdDealUseCase,
        private readonly lockEscrow: LockEscrowUseCase,
        private readonly paymentsService: PaymentsService,
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

        await ctx.reply(
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

        await ctx.reply('💰 Enter amount (USD):');
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

        await ctx.reply('🤝 Enter publisher Telegram ID:');
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }
        const fsm = context.fsm;
        const commandMatch = text.match(/^\/(fund_addeal|lock_addeal)\s+(\S+)/);
        if (commandMatch) {
            const [, command, adDealId] = commandMatch;
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.advertiserId !== context.user.id) {
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
                    return ctx.reply(`✅ AdDeal funded\nID: ${adDealId}`);
                }

                if (command === 'lock_addeal') {
                    await this.lockEscrow.execute({
                        adDealId,
                        actor: TransitionActor.advertiser,
                    });
                    return ctx.reply(`🔒 Escrow locked\nID: ${adDealId}`);
                }
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_addeal_command_failed',
                    command,
                    adDealId,
                    userId,
                    role: fsm.role,
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
                    context.user.id,
                    amount,
                    idempotencyKey,
                );

                const wallet = await this.prisma.wallet.findUnique({
                    where: { userId: context.user.id },
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                    { amount: amount.toFixed(2) },
                );

                const balanceText = wallet?.balance
                    ? wallet.balance.toFixed(2)
                    : amount.toFixed(2);
                return ctx.reply(
                    `✅ Deposit completed\nAmount: $${amount.toFixed(2)}\nBalance: $${balanceText}`,
                );
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_deposit_failed',
                    userId,
                    role: fsm.role,
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
            if (!fsm.payload.publisherId) {
                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                );
                return ctx.reply(
                    '⚠️ Session expired. Please restart deal creation with "Create AdDeal".',
                );
            }

            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return ctx.reply('❌ Invalid amount');
            }

            if (new Prisma.Decimal(amountText).lte(0)) {
                return ctx.reply('❌ Invalid amount');
            }

            try {
                const wallet = await this.prisma.wallet.findUnique({
                    where: { userId: context.user.id },
                });

                const requiredAmount = new Prisma.Decimal(amountText);
                if (!wallet || wallet.balance.lt(requiredAmount)) {
                    return ctx.reply(
                        `❌ Insufficient balance. Deposit at least $${requiredAmount.toFixed(2)} before creating a deal.`,
                    );
                }

                const adDeal = await this.createAdDeal.execute({
                    advertiserId: context.user.id,
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

                return ctx.reply(
                    `✅ AdDeal created & escrow locked\nID: ${adDeal.id}\n\n` +
                    `Next steps:\n` +
                    `• Publisher: /accept_addeal ${adDeal.id}\n` +
                    `• Publisher: /submit_proof ${adDeal.id} <proof>`,
                );
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_addeal_create_failed',
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
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

    private async ensureAdvertiser(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Telegram user not found.');
            return null;
        }

        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(userId) },
        });

        if (!user) {
            await ctx.reply('❌ Advertiser account not found.');
            return null;
        }

        if (user.role !== UserRole.advertiser) {
            this.logger.warn({
                event: 'telegram_role_block',
                action: 'advertiser_access',
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
            fsm.role !== 'advertiser'
                ? await this.fsm.updateRole(userId, 'advertiser')
                : fsm;

        return { user, fsm: syncedFsm };
    }
}
