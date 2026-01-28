import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, LoggerService } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Telegraf, Context } from 'telegraf';
import { AdminHandler } from './handlers/admin.handler';
import { PostJobStatus, Prisma } from '@prisma/client';
import {
    TelegramAdminPermission,
    TelegramCheckReason,
    TelegramCheckResult,
} from '@/modules/telegram/telegram.types';

const bigintToSafeNumber = (value: bigint, field: string): number => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);

    if (value > maxSafe || value < minSafe) {
        throw new Error(`${field} exceeds safe integer range`);
    }
    return Number(value);
};

const REQUIRED_BOT_PERMISSIONS: TelegramAdminPermission[] = [
    'can_manage_chat',
    'can_post_messages',
    'can_edit_messages',
    'can_delete_messages',
];

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
    private readonly bot: Telegraf<Context>;
    private started = false;
    private botId?: number;



    constructor(
        private readonly prisma: PrismaService,
        private readonly adminHandler: AdminHandler,
          @Inject('LOGGER') private readonly logger: LoggerService,
    ) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
        this.bot = new Telegraf(token);
    }

    async onModuleInit() {
        const smokeTestEnabled = process.env.ENABLE_TELEGRAM_SMOKE_TEST === 'true';
        if (smokeTestEnabled && process.env.NODE_ENV !== 'production') {
            void this.sendTestToMyChannel();
        }

        this.registerAdminCommands();

        const autostart = process.env.TELEGRAM_AUTOSTART === 'true';
        if (!autostart) {
            this.logger.warn({
                event: 'telegram_bot_autostart_disabled',
                autostart
            },
                'TelegramService'
            );
            return;
        }

        void this.startBot();
    }

    private async sendTestToMyChannel() {
        const channel = process.env.TELEGRAM_TEST_CHANNEL;
        if (!channel) {
            this.logger.warn({
                event: 'telegram_smoke_test_channel_not_set',
            },
                'TelegramService'
            );
            return;
        }
        await this.bot.telegram.sendMessage(channel, '✅ bot startup test');
    }


    async onModuleDestroy() {
        if (!this.started) return;
        try {
            this.bot.stop('shutdown');
            this.logger.log({
                event: 'telegram_bot_stopped',
                id: this.botId ?? null,

            },
                'TelegramService');
        } catch (e) {
            this.logger.warn({
                event: 'telegram_bot_stop_failed',
                error: e instanceof Error ? e.message : String(e),
                id: this.botId ?? null,      
            },
                'TelegramService'
            );
        }
    }



    private async startBot() {
        if (this.started) return;

        // ✅ Debug: real channel id ni olish (dev-only)
        if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEBUG === 'true') {
            this.bot.on('channel_post', (ctx) => {
                const chat: any = ctx.chat;
                this.logger.warn({
                    event: 'telegram_channel_post_received',
                    channelId: chat.id,
                    channelTitle: chat.title,
                    chatType: chat.type,
                },
                    'TelegramService'
                );
            });
        }

        try {
            this.logger.log({
                event: 'telegram_bot_starting',
                botId: this.botId ?? null,

            },
                'TelegramService');
            await this.bot.launch({ dropPendingUpdates: true });
            this.started = true;
            this.logger.log({
                event: 'telegram_bot_started',
                id: this.botId ?? null,
            },
                'TelegramService');
        } catch (e) {
            this.logger.error({
                event: 'telegram_bot_start_failed',
                error: e instanceof Error ? e.message : String(e),
            },
                'TelegramService');
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
                this.logger.warn({
                    event: 'telegram_action_retry',
                    action,
                    attempt,
                    maxAttempts,
                    backoffMs,
                    error: this.sanitizeTelegramError(
                        this.extractTelegramError(err).message,
                    ),
                },
                    'TelegramService'
                );
                await new Promise((r) => setTimeout(r, backoffMs));
            }
        }

        throw new Error(`${action} failed`);
    }

    private sanitizeTelegramError(message?: string): string | undefined {
        if (!message) {
            return undefined;
        }
        return message.replace(/(bot token|token)=\S+/gi, '$1=***').slice(0, 300);
    }

    private extractTelegramError(err: unknown): {
        description?: string;
        errorCode?: number;
        retryAfterSeconds?: number;
        message?: string;
        code?: string;
    } {
        if (err && typeof err === 'object') {
            const response = (err as { response?: { error_code?: number; description?: string; parameters?: { retry_after?: number } } }).response;
            const responseBody = (response as { body?: { error_code?: number; description?: string; parameters?: { retry_after?: number } } })?.body;
            return {
                description: response?.description ?? responseBody?.description,
                errorCode: response?.error_code ?? responseBody?.error_code,
                retryAfterSeconds:
                    response?.parameters?.retry_after
                    ?? responseBody?.parameters?.retry_after
                    ?? (err as { parameters?: { retry_after?: number } })?.parameters?.retry_after,
                message: err instanceof Error ? err.message : undefined,
                code: (err as { code?: string })?.code,
            };
        }

        return { message: typeof err === 'string' ? err : undefined };
    }

    private classifyTelegramError(err: unknown): TelegramCheckResult {
        const { description, errorCode, retryAfterSeconds, message, code } = this.extractTelegramError(err);
        const rawMessage = description ?? message;
        const lowerMessage = rawMessage?.toLowerCase() ?? '';
        const sanitizedError = this.sanitizeTelegramError(rawMessage);

        if (errorCode === 429 || lowerMessage.includes('too many requests')) {
            return {
                canAccessChat: false,
                isAdmin: false,
                reason: TelegramCheckReason.RATE_LIMIT,
                telegramError: sanitizedError,
                retryAfterSeconds: retryAfterSeconds ?? null,
            };
        }

        const networkCodes = new Set([
            'ETIMEDOUT',
            'ECONNRESET',
            'ENOTFOUND',
            'ECONNREFUSED',
            'EAI_AGAIN',
            'ENETUNREACH',
            'EHOSTUNREACH',
        ]);
        if (
            (code && networkCodes.has(code))
            || lowerMessage.includes('timeout')
            || lowerMessage.includes('timed out')
            || lowerMessage.includes('network')
            || lowerMessage.includes('socket hang up')
        ) {
            return {
                canAccessChat: false,
                isAdmin: false,
                reason: TelegramCheckReason.NETWORK,
                telegramError: sanitizedError,
                retryAfterSeconds: retryAfterSeconds ?? null,
            };
        }

        if (
            lowerMessage.includes('bot was kicked')
            || lowerMessage.includes('bot was banned')
            || lowerMessage.includes('bot was blocked')
            || lowerMessage.includes('bot was removed')
            || lowerMessage.includes('bot is not a member')
        ) {
            return {
                canAccessChat: false,
                isAdmin: false,
                reason: TelegramCheckReason.BOT_KICKED,
                telegramError: sanitizedError,
                retryAfterSeconds: retryAfterSeconds ?? null,
            };
        }

        if (
            lowerMessage.includes('not enough rights')
            || lowerMessage.includes('administrator rights')
            || lowerMessage.includes('admin rights')
            || lowerMessage.includes('chat admin required')
            || lowerMessage.includes('need administrator rights')
        ) {
            return {
                canAccessChat: true,
                isAdmin: false,
                reason: TelegramCheckReason.BOT_NOT_ADMIN,
                telegramError: sanitizedError,
                retryAfterSeconds: retryAfterSeconds ?? null,
            };
        }

        if (
            lowerMessage.includes('chat not found')
            || lowerMessage.includes('channel not found')
        ) {
            return {
                canAccessChat: false,
                isAdmin: false,
                reason: TelegramCheckReason.CHAT_NOT_FOUND,
                telegramError: sanitizedError,
                retryAfterSeconds: retryAfterSeconds ?? null,
            };
        }

        return {
            canAccessChat: false,
            isAdmin: false,
            reason: TelegramCheckReason.UNKNOWN,
            telegramError: sanitizedError,
            retryAfterSeconds: retryAfterSeconds ?? null,
        };
    }

    async checkBotAdmin(channelId: string): Promise<TelegramCheckResult> {
        try {
            const admins = await this.withTelegramRetry(
                'getChatAdministrators',
                () => this.bot.telegram.getChatAdministrators(channelId),
            );
            const botId = await this.getBotId();
            const botAdmin = admins.find((admin) => admin.user.id === botId);

            if (!botAdmin) {
                return {
                    canAccessChat: true,
                    isAdmin: false,
                    reason: TelegramCheckReason.BOT_NOT_ADMIN,
                };
            }

            if (botAdmin.status === 'creator') {
                return {
                    canAccessChat: true,
                    isAdmin: true,
                    reason: TelegramCheckReason.UNKNOWN,
                };
            }

            const hasRequiredPermissions = REQUIRED_BOT_PERMISSIONS.every(
                (permission) => Boolean((botAdmin as unknown as Record<string, unknown>)[permission]),
            );

            if (!hasRequiredPermissions) {
                return {
                    canAccessChat: true,
                    isAdmin: false,
                    reason: TelegramCheckReason.BOT_NOT_ADMIN,
                };
            }

            return {
                canAccessChat: true,
                isAdmin: true,
                reason: TelegramCheckReason.UNKNOWN,
            };
        } catch (err) {
            return this.classifyTelegramError(err);
        }
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
                this.logger.warn({
                    event: 'telegram_send_post_retry',
                    postJobId,
                    attempt,
                    maxAttempts,
                    error: this.sanitizeTelegramError(msg),
                },
                    'TelegramService'
                );

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