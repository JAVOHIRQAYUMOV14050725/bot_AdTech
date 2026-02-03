// handlers/start.handler.ts
import { Update, Start, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { PrismaService } from '@/prisma/prisma.service';
import { UserRole } from '@/modules/domain/contracts';
import { advertiserHome, publisherHome } from '../keyboards';

@Update()
export class StartHandler {
    private readonly logger = new Logger(StartHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
    ) { }

    @Start()
    async start(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;

        const existing = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(userId) },
            select: { id: true, role: true },
        });

        if (existing) {
            if (existing.role === UserRole.publisher) {
                await this.fsm.set(userId, 'publisher', TelegramState.PUB_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: existing.id,
                    telegramUserId: userId,
                    role: existing.role,
                });
                await ctx.reply(
                    `✅ Welcome back!\n\n📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
                    publisherHome,
                );
                return;
            }

            if (existing.role === UserRole.advertiser) {
                await this.fsm.set(userId, 'advertiser', TelegramState.ADV_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: existing.id,
                    telegramUserId: userId,
                    role: existing.role,
                });
                await ctx.reply(
                    `✅ Welcome back!\n\n🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
                    advertiserHome,
                );
                return;
            }

            await this.fsm.set(userId, 'admin', TelegramState.ADMIN_PANEL);
            this.logger.log({
                event: 'user_state_recovered',
                userId: existing.id,
                telegramUserId: userId,
                role: existing.role,
            });
            await ctx.reply('✅ Welcome back! Admin mode enabled.');
            return;
        }

        await this.fsm.set(userId, null, TelegramState.SELECT_ROLE);

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
