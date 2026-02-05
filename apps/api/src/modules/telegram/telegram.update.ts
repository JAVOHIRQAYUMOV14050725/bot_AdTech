import { Update, Start, Action, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../application/telegram/telegram-fsm.service';
import { TelegramState } from '../application/telegram/telegram-fsm.types';
import { replySafe } from '@/modules/telegram/telegram-safe-text.util';

@Update()
export class TelegramUpdate {
    constructor(private readonly fsm: TelegramFSMService) { }

    @Start()
    async start(@Ctx() ctx: Context) {
        await this.fsm.reset(ctx.from!.id);

        await replySafe(
            ctx,
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