import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../fsm/telegram-fsm.service';
import { TelegramState } from '../fsm/telegram-fsm.types';
import { advertiserHome, confirmKeyboard } from '../keyboards';
@Update()
export class AdvertiserHandler {
    constructor(private readonly fsm: TelegramFSMService) { }
    @Action('ROLE_ADVERTISER')
    async advertiser(@Ctx() ctx: Context) {
        await this.fsm.setRole(
            ctx.from!.id,
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
        await this.fsm.setState(
            ctx.from!.id,
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

        // 🔐 ROLE CHECK
        if (fsm.role !== 'advertiser') return;

        if (fsm.state === TelegramState.ADV_ADD_BALANCE_AMOUNT) {
            const amount = Number(text);
            if (!Number.isFinite(amount) || amount <= 0) {
                return ctx.reply('❌ Invalid amount');
            }

            await this.fsm.patch(userId, {
                payload: { ...fsm.payload, amount },
                state: TelegramState.ADV_DASHBOARD,
            });

            await ctx.reply(`✅ Balance updated`);
        }
    }


    @Action('CONFIRM')
    async confirm(@Ctx() ctx: Context) {
        const fsm = await this.fsm.get(ctx.from!.id);
        if (!fsm.payload.amount) {
            return ctx.reply('Nothing to confirm.');
        }

        // paymentsService.deposit(...)
        await this.fsm.reset(ctx.from!.id);

        await ctx.reply('✅ Balance updated.');
    }
}
