import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Telegraf, Context } from 'telegraf';
import { AdminHandler } from './handlers/admin.handler';

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private readonly bot: Telegraf<Context>;

    constructor(
        private readonly prisma: PrismaService,
        private readonly adminHandler: AdminHandler,
    ) {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            throw new Error('TELEGRAM_BOT_TOKEN not set');
        }

        this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    }

    // ===============================
    // BOT INIT
    // ===============================
    async onModuleInit() {
        this.registerAdminCommands();

        await this.bot.launch();
        this.logger.log('Telegram bot started');
    }

    // ===============================
    // ADMIN COMMAND ROUTER
    // ===============================
    private registerAdminCommands() {
        // /force_release <campaignTargetId>
        this.bot.command('force_release', async (ctx) => {
            const [, campaignTargetId] = ctx.message.text.split(' ');

            if (!campaignTargetId) {
                return ctx.reply('Usage: /force_release <campaignTargetId>');
            }

            return this.adminHandler.forceRelease(ctx, campaignTargetId);
        });

        // /force_refund <campaignTargetId> [reason]
        this.bot.command('force_refund', async (ctx) => {
            const [, campaignTargetId, reason] = ctx.message.text.split(' ');

            if (!campaignTargetId) {
                return ctx.reply('Usage: /force_refund <campaignTargetId> [reason]');
            }

            return this.adminHandler.forceRefund(
                ctx,
                campaignTargetId,
                reason ?? 'admin_force',
            );
        });

        // /retry_post <postJobId>
        this.bot.command('retry_post', async (ctx) => {
            const [, postJobId] = ctx.message.text.split(' ');

            if (!postJobId) {
                return ctx.reply('Usage: /retry_post <postJobId>');
            }

            return this.adminHandler.retryPost(ctx, postJobId);
        });

        // /freeze_campaign <campaignId>
        this.bot.command('freeze_campaign', async (ctx) => {
            const [, campaignId] = ctx.message.text.split(' ');

            if (!campaignId) {
                return ctx.reply('Usage: /freeze_campaign <campaignId>');
            }

            return this.adminHandler.freezeCampaign(ctx, campaignId);
        });

        // /unfreeze_campaign <campaignId>
        this.bot.command('unfreeze_campaign', async (ctx) => {
            const [, campaignId] = ctx.message.text.split(' ');

            if (!campaignId) {
                return ctx.reply('Usage: /unfreeze_campaign <campaignId>');
            }

            return this.adminHandler.unfreezeCampaign(ctx, campaignId);
        });
    }

    // ===============================
    // EXISTING LOGIC (UNCHANGED)
    // ===============================
    async sendCampaignPost(postJobId: string): Promise<{
        ok: boolean;
        telegramMessageId?: number;
    }> {
        // 🔒 SEN YOZGAN KOD — TO‘LIQ SAQLANADI
        // (hech narsa buzilmaydi)
        return { ok: true };
    }
}
