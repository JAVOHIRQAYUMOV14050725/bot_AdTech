// handlers/publisher.handler.ts
import { Update, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../fsm/telegram-fsm.service';
import { TelegramState } from '../fsm/telegram-fsm.types';
import { publisherHome } from '../keyboards';

@Update()
export class PublisherHandler {
    constructor(private readonly fsm: TelegramFSMService) { }
    @Action('ROLE_PUBLISHER')
    async publisher(@Ctx() ctx: Context) {
        await this.fsm.setRole(
            ctx.from!.id,
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
        await this.fsm.setState(
            ctx.from!.id,
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

        // 🔐 ROLE CHECK
        if (fsm.role !== 'publisher') return;

        if (fsm.state === TelegramState.PUB_ADD_CHANNEL) {
            await this.fsm.patch(userId, {
                payload: { channel: text },
                state: TelegramState.PUB_DASHBOARD,
            });

            await ctx.reply(`🔍 Channel received: ${text}`);
        }
    }

}
