// handlers/start.handler.ts
import { Update, Start, Ctx, Action } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../fsm/telegram-fsm.service';
import { TelegramState } from '../fsm/telegram-fsm.types';

@Update()
export class StartHandler {
    constructor(private readonly fsm: TelegramFSMService) { }

    @Start()
    async start(@Ctx() ctx: Context) {
        await this.fsm.reset(ctx.from!.id);

        await ctx.reply(
            `👋 Welcome to AdTech\n\nWho are you?`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🧑‍💼 Advertiser', callback_data: 'ROLE_ADVERTISER' }],
                        [{ text: '📣 Publisher', callback_data: 'ROLE_PUBLISHER' }],
                    ],
                },
            },
        );
    }

}
