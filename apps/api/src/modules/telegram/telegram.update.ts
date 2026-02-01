// src/telegram/telegram.update.ts
import { Ctx, Start, Update, Action, On } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { roleKeyboard, advertiserHome, confirmKeyboard } from './keyboards';
import { UserFlow, UserSession } from './state';

function getText(ctx: Context): string | null {
    if (!ctx.message) return null;
    if (!('text' in ctx.message)) return null;
    return ctx.message.text;
}


@Update()
export class TelegramUpdate {
    private sessions = new Map<number, UserSession>();

    private getSession(userId: number): UserSession {
        if (!this.sessions.has(userId)) {
            this.sessions.set(userId, { flow: UserFlow.NONE });
        }
        return this.sessions.get(userId)!;
    }

    @Start()
    async start(@Ctx() ctx: Context) {
        await ctx.reply(
            `👋 Welcome to AdTech

Safe Telegram advertising with escrow protection.

Who are you?`,
            roleKeyboard,
        );
    }

    // ─────────────────────────────
    // ROLE SELECT
    // ─────────────────────────────
    @Action('ROLE_ADVERTISER')
    async advertiser(@Ctx() ctx: Context) {
        await ctx.reply(
            `🧑‍💼 Advertiser Panel

💰 Balance: $0.00
📊 Active campaigns: 0`,
            advertiserHome,
        );
    }

    // ─────────────────────────────
    // ADD BALANCE
    // ─────────────────────────────
    @Action('ADD_BALANCE')
    async addBalance(@Ctx() ctx: Context) {
        const session = this.getSession(ctx.from!.id);
        session.flow = UserFlow.ADD_BALANCE_AMOUNT;

        await ctx.reply(
            `💰 Add balance

Enter amount (USD):`,
        );
    }
    

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text = getText(ctx);
        if (!text) return;

        const session = this.getSession(ctx.from!.id);

        if (session.flow === UserFlow.ADD_BALANCE_AMOUNT) {
            const amount = Number(text);

            if (!Number.isFinite(amount) || amount <= 0) {
                await ctx.reply('❌ Invalid amount. Try again.');
                return;
            }

            session.payload = { amount };
            session.flow = UserFlow.NONE;

            await ctx.reply(
                `You are adding $${amount.toFixed(2)}.\n\nProceed?`,
                confirmKeyboard,
            );
        }
    }


    @Action('CONFIRM')
    async confirm(@Ctx() ctx: Context) {
        const session = this.getSession(ctx.from!.id);
        const amount = session.payload?.amount;

        if (!amount) {
            await ctx.reply('Nothing to confirm.');
            return;
        }

        // 👉 BU YERDA REAL BACKEND
        // await paymentsService.deposit(...)

        session.payload = undefined;

        await ctx.reply(
            `✅ Balance updated

New balance: $${amount.toFixed(2)}`,
        );
    }

    @Action('CANCEL')
    async cancel(@Ctx() ctx: Context) {
        const session = this.getSession(ctx.from!.id);
        session.flow = UserFlow.NONE;
        session.payload = undefined;

        await ctx.reply('❌ Cancelled.');
    }
}
