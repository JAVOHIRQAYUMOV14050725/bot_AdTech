
// handlers/start.handler.ts
import { Update, Start, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome, publisherHome } from '../keyboards';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { extractTelegramErrorMeta, telegramSafeErrorMessageWithCorrelation } from '@/modules/telegram/telegram-error.util';

@Update()
export class StartHandler {
    private readonly logger = new Logger(StartHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly backendClient: TelegramBackendClient,
    ) { }

    @Start()
    async start(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const rawUsername = ctx.from?.username ?? null;
        const username = rawUsername
            ? `@${rawUsername.replace(/^@+/, '')}`
            : null;
        const updateId = ctx.update?.update_id ? ctx.update.update_id.toString() : null;
        const payload =
            ctx.message && 'text' in ctx.message
                ? ctx.message.text?.split(' ').slice(1).join(' ')
                : '';
        const startPayload = payload?.trim() || null;

        try {
            const response = await this.backendClient.startTelegramSession({
                telegramId: userId.toString(),
                username,
                startPayload,
                updateId,
            });

            const roles = response.user.roles ?? [response.user.role];
            if (roles.includes('publisher')) {
                await this.fsm.set(userId, 'publisher', TelegramState.PUB_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: response.user.id,
                    telegramUserId: userId,
                    role: 'publisher',
                    linkedInvite: response.linkedInvite,
                });
                const intro = response.created || response.linkedInvite
                    ? '👋 Welcome to AdTech!'
                    : '✅ Welcome back!';
                await ctx.reply(
                    `${intro}\n\n📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
                    publisherHome,
                );
                return;
            }

            if (roles.includes('advertiser')) {
                await this.fsm.set(userId, 'advertiser', TelegramState.ADV_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: response.user.id,
                    telegramUserId: userId,
                    role: 'advertiser',
                    linkedInvite: response.linkedInvite,
                });
                const intro = response.created ? '👋 Welcome to AdTech!' : '✅ Welcome back!';
                await ctx.reply(
                    `${intro}\n\n🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
                    advertiserHome,
                );
                return;
            }

            await this.fsm.set(userId, 'admin', TelegramState.ADMIN_PANEL);
            this.logger.log({
                event: 'user_state_recovered',
                userId: response.user.id,
                telegramUserId: userId,
                role: response.user.role,
                linkedInvite: response.linkedInvite,
            });
            await ctx.reply('✅ Welcome back! Admin mode enabled.');
            return;
        } catch (err) {
            const { code } = extractTelegramErrorMeta(err);
            const message =
                code === 'INVITE_NOT_FOR_YOU'
                    ? '❌ Bu taklif sizga tegishli emas.'
                    : `❌ ${telegramSafeErrorMessageWithCorrelation(err)}`;
            this.logger.error({
                event: 'telegram_start_failed',
                telegramUserId: userId,
                error: typeof message === 'string' ? message : 'telegram_start_failed',
            });
            await ctx.reply(message);
        }
    }
}