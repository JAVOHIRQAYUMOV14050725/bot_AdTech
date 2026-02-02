import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAdDealUseCase } from '@/modules/application/addeal/create-addeal.usecase';
import { Prisma } from '@prisma/client';

@Update()
export class AdvertiserHandler {
    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly createAdDeal: CreateAdDealUseCase,
    ) { }

    @Action('ROLE_ADVERTISER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;

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
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'advertiser') {
            await ctx.reply('⛔ Not allowed yet. Switch to advertiser role.');
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
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'advertiser') {
            await ctx.reply('⛔ Not allowed yet. Switch to advertiser role.');
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
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'advertiser') {
            await ctx.reply('⛔ Not allowed yet. Switch to advertiser role.');
            return;
        }
        const commandMatch = text.match(/^\/(fund_addeal|lock_addeal)\s+(\S+)/);
        if (commandMatch) {
            const [, command, adDealId] = commandMatch;
            const user = await this.prisma.user.findUnique({
                where: { telegramId: BigInt(userId) },
            });

            if (!user) {
                return ctx.reply('❌ Advertiser account not found');
            }

            const adDeal = await this.prisma.adDeal.findUnique({
                where: { id: adDealId },
            });

            if (!adDeal || adDeal.advertiserId !== user.id) {
                return ctx.reply('❌ AdDeal not found for advertiser');
            }

            if (command === 'fund_addeal') {
                return ctx.reply(
                    '⛔ Funding requires a verified provider callback. Telegram cannot move money directly.',
                );
            }

            if (command === 'lock_addeal') {
                return ctx.reply(
                    '⛔ Escrow locking must be confirmed server-side after wallet verification.',
                );
            }
        }

        if (fsm.state === TelegramState.ADV_ADD_BALANCE_AMOUNT) {
            const amount = Number(text);
            if (!Number.isFinite(amount) || amount <= 0) {
                return ctx.reply('❌ Invalid amount');
            }

            await this.fsm.transition(
                userId,
                TelegramState.ADV_DASHBOARD,
                { amount },
            );

            return ctx.reply(
                '📝 Deposit amount recorded. Balance updates only after a verified provider deposit.',
            );
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_PUBLISHER) {
            const publisherTelegramId = Number(text);
            if (!Number.isSafeInteger(publisherTelegramId)) {
                return ctx.reply('❌ Invalid Telegram ID');
            }

            const publisher = await this.prisma.user.findUnique({
                where: { telegramId: BigInt(publisherTelegramId) },
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

            const advertiser = await this.prisma.user.findUnique({
                where: { telegramId: BigInt(userId) },
            });

            if (!advertiser) {
                return ctx.reply('❌ Advertiser not found');
            }

            const adDeal = await this.createAdDeal.execute({
                advertiserId: advertiser.id,
                publisherId: fsm.payload.publisherId,
                amount: amountText,
            });

            await this.fsm.transition(
                userId,
                TelegramState.ADV_DASHBOARD,
            );

            return ctx.reply(
                `✅ AdDeal created\nID: ${adDeal.id}\n\n` +
                `Next steps:\n` +
                `• Fund via verified provider callback\n` +
                `• Escrow locks after wallet verification`,
            );
        }

        return undefined;
    }
}