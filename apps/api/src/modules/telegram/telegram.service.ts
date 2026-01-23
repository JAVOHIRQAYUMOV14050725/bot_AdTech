import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Telegraf, Context } from 'telegraf';
import { AdminHandler } from './handlers/admin.handler';
import { PostJobStatus, Prisma } from '@prisma/client';

const bigintToSafeNumber = (value: bigint, field: string): number => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);

    if (value > maxSafe || value < minSafe) {
        throw new Error(`${field} exceeds safe integer range`);
    }
    return Number(value);
};

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TelegramService.name);
    private readonly bot: Telegraf<Context>;
    private started = false;
    private botId?: number;

    constructor(
        private readonly prisma: PrismaService,
        private readonly adminHandler: AdminHandler,
    ) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
        this.bot = new Telegraf(token);
    }

    async onModuleInit() {
        this.registerAdminCommands();

        // ✅ API start bloklanmasin
        const autostart = process.env.TELEGRAM_AUTOSTART === 'true';
        if (!autostart) {
            this.logger.warn('Telegram autostart disabled (set TELEGRAM_AUTOSTART=true to enable)');
            return;
        }

        // ✅ await qilmaymiz — Nest HTTP server ochilib ketadi
        void this.startBot();
    }

    async onModuleDestroy() {
        if (!this.started) return;
        try {
            this.bot.stop('shutdown');
            this.logger.log('Telegram bot stopped');
        } catch (e) {
            this.logger.warn(`Telegram bot stop error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async startBot() {
        if (this.started) return;
        try {
            this.logger.log('Launching Telegram bot...');
            await this.bot.launch({ dropPendingUpdates: true });
            this.started = true;
            this.logger.log('Telegram bot started');
        } catch (e) {
            this.logger.error(
                `Telegram bot failed to start: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    // ===============================
    // ADMIN COMMAND ROUTER
    // ===============================
    private registerAdminCommands() {
        this.bot.command('force_release', async (ctx) => {
            const [, campaignTargetId] = ctx.message.text.split(' ');
            if (!campaignTargetId) return ctx.reply('Usage: /force_release <campaignTargetId>');
            return this.adminHandler.forceRelease(ctx, campaignTargetId);
        });

        this.bot.command('force_refund', async (ctx) => {
            const [, campaignTargetId, reason] = ctx.message.text.split(' ');
            if (!campaignTargetId) return ctx.reply('Usage: /force_refund <campaignTargetId> [reason]');
            return this.adminHandler.forceRefund(ctx, campaignTargetId, reason ?? 'admin_force');
        });

        this.bot.command('retry_post', async (ctx) => {
            const [, postJobId] = ctx.message.text.split(' ');
            if (!postJobId) return ctx.reply('Usage: /retry_post <postJobId>');
            return this.adminHandler.retryPost(ctx, postJobId);
        });

        this.bot.command('freeze_campaign', async (ctx) => {
            const [, campaignId] = ctx.message.text.split(' ');
            if (!campaignId) return ctx.reply('Usage: /freeze_campaign <campaignId>');
            return this.adminHandler.freezeCampaign(ctx, campaignId);
        });

        this.bot.command('unfreeze_campaign', async (ctx) => {
            const [, campaignId] = ctx.message.text.split(' ');
            if (!campaignId) return ctx.reply('Usage: /unfreeze_campaign <campaignId>');
            return this.adminHandler.unfreezeCampaign(ctx, campaignId);
        });
    }

    // ===============================
    // EXISTING LOGIC (UNCHANGED)
    // ===============================
    private async getBotId(): Promise<number> {
        if (this.botId) {
            return this.botId;
        }
        const me = await this.bot.telegram.getMe();
        this.botId = me.id;
        return me.id;
    }

    async checkConnection(): Promise<{ id: number; username?: string }> {
        const me = await this.bot.telegram.getMe();
        this.botId = me.id;
        return { id: me.id, username: me.username };
    }

    private async withTelegramRetry<T>(action: string, fn: () => Promise<T>): Promise<T> {
        const maxAttempts = Number(process.env.TELEGRAM_SEND_MAX_ATTEMPTS ?? 3);
        const baseDelayMs = Number(process.env.TELEGRAM_SEND_BASE_DELAY_MS ?? 1000);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await fn();
            } catch (err) {
                const retryAfterSeconds =
                    (err as { response?: { parameters?: { retry_after?: number } } })?.response?.parameters?.retry_after ??
                    (err as { parameters?: { retry_after?: number } })?.parameters?.retry_after;

                if (attempt === maxAttempts) {
                    throw err;
                }

                const backoffMs =
                    typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
                        ? retryAfterSeconds * 1000
                        : baseDelayMs * 2 ** (attempt - 1);
                this.logger.warn(
                    `${action} failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms`,
                );
                await new Promise((r) => setTimeout(r, backoffMs));
            }
        }

        throw new Error(`${action} failed`);
    }

    async isBotAdmin(channelId: string): Promise<boolean> {
        const admins = await this.withTelegramRetry(
            'getChatAdministrators',
            () => this.bot.telegram.getChatAdministrators(channelId),
        );
        const botId = await this.getBotId();
        return admins.some((admin) => admin.user.id === botId);
    }

    async sendCampaignPost(postJobId: string): Promise<{ ok: boolean; telegramMessageId?: number }> {
        const postJob = await this.prisma.postJob.findUnique({
            where: { id: postJobId },
            include: {
                campaignTarget: { include: { campaign: { include: { creatives: true } }, channel: true } },
                executions: true,
            },
        });

        if (!postJob) throw new Error('PostJob not found');

        if (postJob.telegramMessageId) {
            return {
                ok: true,
                telegramMessageId: bigintToSafeNumber(
                    postJob.telegramMessageId,
                    'telegramMessageId',
                ),
            };
        }

        const existingExecution = postJob.executions.find((e) => e.telegramMessageId);
        if (existingExecution?.telegramMessageId) {
            if (!postJob.telegramMessageId) {
                await this.prisma.postJob.update({
                    where: { id: postJobId },
                    data: { telegramMessageId: existingExecution.telegramMessageId },
                });
            }
            return {
                ok: true,
                telegramMessageId: bigintToSafeNumber(existingExecution.telegramMessageId, 'telegramMessageId'),
            };
        }

        if (postJob.status === PostJobStatus.success) return { ok: true };

        const channelId = postJob.campaignTarget.channel.telegramChannelId;
        const telegramChannelId = channelId.toString();
        const creative = postJob.campaignTarget.campaign.creatives[0];
        if (!creative) throw new Error('Campaign creative not found');

        const sendPayload = creative.contentPayload as Prisma.JsonObject;

        const maxAttempts = Number(process.env.TELEGRAM_SEND_MAX_ATTEMPTS ?? 3);
        const baseDelayMs = Number(process.env.TELEGRAM_SEND_BASE_DELAY_MS ?? 1000);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                let response: { message_id?: number };

                if (creative.contentType === 'text') {
                    const text = String(sendPayload?.text ?? '');
                    if (!text.trim()) throw new Error('Creative text payload missing');
                    response = await this.bot.telegram.sendMessage(telegramChannelId, text);
                } else if (creative.contentType === 'image') {
                    const imageUrl = String(sendPayload?.url ?? '');
                    if (!imageUrl.trim()) throw new Error('Creative image payload missing');
                    response = await this.bot.telegram.sendPhoto(telegramChannelId, imageUrl, {
                        caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                    });
                } else if (creative.contentType === 'video') {
                    const videoUrl = String(sendPayload?.url ?? '');
                    if (!videoUrl.trim()) throw new Error('Creative video payload missing');
                    response = await this.bot.telegram.sendVideo(telegramChannelId, videoUrl, {
                        caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                    });
                } else {
                    throw new Error('Unsupported creative type');
                }

                const messageId = response.message_id;

                await this.prisma.postExecutionLog.create({
                    data: {
                        postJobId,
                        telegramMessageId: messageId ? BigInt(messageId) : null,
                        responsePayload: sendPayload,
                    },
                });

                return { ok: true, telegramMessageId: messageId };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Telegram send failed (attempt ${attempt}/${maxAttempts}): ${msg}`);

                if (attempt === maxAttempts) return { ok: false };

                const retryAfterSeconds =
                    (err as { response?: { parameters?: { retry_after?: number } } })?.response?.parameters?.retry_after ??
                    (err as { parameters?: { retry_after?: number } })?.parameters?.retry_after;

                const backoffMs =
                    typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
                        ? retryAfterSeconds * 1000
                        : baseDelayMs * 2 ** (attempt - 1);
                await new Promise((r) => setTimeout(r, backoffMs));
            }
        }

        return { ok: false };
    }
}
