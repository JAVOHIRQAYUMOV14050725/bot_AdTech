import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome, confirmKeyboard } from '../keyboards';

@Update()
export class AdvertiserHandler {
    constructor(private readonly fsm: TelegramFSMService) { }

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

        if (fsm.role !== 'advertiser') return;

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADD_BALANCE_AMOUNT,
        );

        await ctx.reply('💰 Enter amount (USD):');
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const fsm = await this.fsm.get(userId);

        if (fsm.role !== 'advertiser') return;
        if (fsm.state !== TelegramState.ADV_ADD_BALANCE_AMOUNT) return;

        const amount = Number(text);
        if (!Number.isFinite(amount) || amount <= 0) {
            return ctx.reply('❌ Invalid amount');
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_DASHBOARD,
            { amount },
        );

        await ctx.reply(`✅ Balance updated`);
    }
}
