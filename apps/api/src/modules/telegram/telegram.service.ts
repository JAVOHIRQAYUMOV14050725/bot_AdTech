import { Injectable, OnModuleInit, OnModuleDestroy, Inject, LoggerService } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Telegraf, Context } from 'telegraf';
import { AdminHandler } from './handlers/admin.handler';
import { PostJobStatus, Prisma } from '@prisma/client';
import {
    TelegramAdminPermission,
    TelegramCheckReason,
    TelegramCheckResult,
} from '@/modules/telegram/telegram.types';
import { ConfigService, ConfigType } from '@nestjs/config';
import telegramConfig from '@/config/telegram.config';
import appConfig from '@/config/app.config';
import CircuitBreaker = require('opossum');
import { withTimeout } from '@/common/utils/timeout';
import {
    TelegramCircuitBreakerOpenError,
    TelegramPermanentError,
    TelegramTimeoutError,
    TelegramTransientError,
    TelegramFailureReason,
} from '@/modules/telegram/telegram.errors';

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
    private readonly telegramBreaker: CircuitBreaker;



    constructor(
        private readonly prisma: PrismaService,
        private readonly adminHandler: AdminHandler,
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) {
        const config = this.configService.getOrThrow<ConfigType<typeof telegramConfig>>(
            telegramConfig.KEY,
            { infer: true },
        );
        const token = config.token;
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
        this.bot = new Telegraf(token);
        this.telegramBreaker = new CircuitBreaker(
            async (task: () => Promise<unknown>) => task(),
            {
                timeout: false,
                errorThresholdPercentage: 100,
                volumeThreshold: config.breakerFailureThreshold,
                resetTimeout: config.breakerResetTimeoutMs,
                errorFilter: (err) => !this.shouldCountBreakerFailure(err),
            },
        );
        this.telegramBreaker.on('open', () => {
            this.logger.warn(
                { event: 'telegram_breaker_open', alert: true },
                'TelegramService',
            );
        });
        this.telegramBreaker.on('halfOpen', () => {
            this.logger.warn(
                { event: 'telegram_breaker_half_open' },
                'TelegramService',
            );
        });
        this.telegramBreaker.on('close', () => {
            this.logger.log(
                { event: 'telegram_breaker_closed' },
                'TelegramService',
            );
        });
    }

    async onModuleInit() {
        const app = this.configService.getOrThrow<ConfigType<typeof appConfig>>(
            appConfig.KEY,
            { infer: true },
        );
        const config = this.configService.getOrThrow<ConfigType<typeof telegramConfig>>(
            telegramConfig.KEY,
            { infer: true },
        );
        if (config.smokeTestEnabled && app.nodeEnv !== 'production') {
            void this.sendTestToMyChannel();
        }

        this.registerAdminCommands();

        const autostart = config.autostart;
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
        const config = this.configService.getOrThrow<ConfigType<typeof telegramConfig>>(
            telegramConfig.KEY,
            { infer: true },
        );
        const channel = config.testChannel;
        if (!channel) {
            this.logger.warn({
                event: 'telegram_smoke_test_channel_not_set',
            },
                'TelegramService'
            );
            return;
        }
        await this.executeTelegramAction('sendMessage', () =>
            this.bot.telegram.sendMessage(channel, '✅ bot startup test'),
        );
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
        const app = this.configService.getOrThrow<ConfigType<typeof appConfig>>(
            appConfig.KEY,
            { infer: true },
        );
        if (app.nodeEnv !== 'production' || app.enableDebug) {
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
        const me = await this.executeTelegramAction('getMe', () =>
            this.bot.telegram.getMe(),
        );
        this.botId = me.id;
        return me.id;
    }

    async checkConnection(): Promise<{ id: number; username?: string }> {
        const me = await this.executeTelegramAction('getMe', () =>
            this.bot.telegram.getMe(),
        );
        this.botId = me.id;
        return { id: me.id, username: me.username };
    }

    private async withTelegramRetry<T>(action: string, fn: () => Promise<T>): Promise<T> {
        const config = this.configService.getOrThrow<ConfigType<typeof telegramConfig>>(
            telegramConfig.KEY,
            { infer: true },
        );
        const maxAttempts = config.sendMaxAttempts;
        const baseDelayMs = config.sendBaseDelayMs;

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

    private async withTelegramTimeout<T>(
        action: string,
        fn: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const config = this.configService.getOrThrow<ConfigType<typeof telegramConfig>>(
            telegramConfig.KEY,
            { infer: true },
        );
        return withTimeout(action, fn, {
            timeoutMs: config.requestTimeoutMs,
            errorFactory: () => new TelegramTimeoutError(action, config.requestTimeoutMs),
        });
    }

    private isBreakerOpenError(err: unknown): boolean {
        if (!err || typeof err !== 'object') {
            return false;
        }
        const error = err as { name?: string; code?: string; message?: string };
        return (
            error.name === 'BreakerOpenError'
            || error.code === 'EOPENBREAKER'
            || (error.message ?? '').toLowerCase().includes('breaker is open')
        );
    }

    private shouldCountBreakerFailure(err: unknown): boolean {
        if (err instanceof TelegramTimeoutError) {
            return true;
        }
        const classification = this.classifyTelegramError(err);
        return (
            classification.reason === TelegramCheckReason.RATE_LIMIT
            || classification.reason === TelegramCheckReason.NETWORK
        );
    }

    private wrapTelegramError(action: string, err: unknown): TelegramTransientError | TelegramPermanentError {
        const classification = this.classifyTelegramError(err);
        const description = classification.telegramError
            ?? (err instanceof Error ? err.message : String(err));

        switch (classification.reason) {
            case TelegramCheckReason.RATE_LIMIT:
                return new TelegramTransientError(
                    `Telegram ${action} rate limited`,
                    'RATE_LIMIT',
                    { cause: err },
                );
            case TelegramCheckReason.NETWORK:
                return new TelegramTransientError(
                    `Telegram ${action} network failure`,
                    'NETWORK',
                    { cause: err },
                );
            case TelegramCheckReason.BOT_KICKED:
                return new TelegramPermanentError(
                    `Telegram ${action} failed: bot removed`,
                    'BOT_KICKED',
                    { cause: err },
                );
            case TelegramCheckReason.BOT_NOT_ADMIN:
                return new TelegramPermanentError(
                    `Telegram ${action} failed: bot lacks admin rights`,
                    'BOT_NOT_ADMIN',
                    { cause: err },
                );
            case TelegramCheckReason.CHAT_NOT_FOUND:
                return new TelegramPermanentError(
                    `Telegram ${action} failed: chat not found`,
                    'CHAT_NOT_FOUND',
                    { cause: err },
                );
            case TelegramCheckReason.UNKNOWN:
            default:
                return new TelegramTransientError(
                    `Telegram ${action} failed: ${description ?? 'unknown error'}`,
                    'UNKNOWN',
                    { cause: err },
                );
        }
    }

    private async executeTelegramAction<T>(
        action: string,
        fn: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        this.logger.log(
            { event: 'telegram_call_start', action },
            'TelegramService',
        );

        try {
            const result = await this.telegramBreaker.fire(() =>
                this.withTelegramRetry(action, () =>
                    this.withTelegramTimeout(action, fn),
                ),
            );
            this.logger.log(
                { event: 'telegram_call_success', action },
                'TelegramService',
            );
            return result as T;
        } catch (err) {
            if (this.isBreakerOpenError(err)) {
                const wrapped = new TelegramCircuitBreakerOpenError({ cause: err });
                this.logger.warn(
                    { event: 'telegram_breaker_open', alert: true, action },
                    'TelegramService',
                );
                throw wrapped;
            }

            if (err instanceof TelegramTimeoutError) {
                this.logger.warn(
                    {
                        event: 'telegram_call_timeout',
                        alert: true,
                        action,
                        timeoutMs: err.timeoutMs,
                    },
                    'TelegramService',
                );
                throw err;
            }

            const wrapped = this.wrapTelegramError(action, err);
            this.logger.warn(
                {
                    event: 'telegram_call_failed',
                    alert: wrapped instanceof TelegramTransientError,
                    action,
                    data: {
                        reason: wrapped.reason,
                        error: this.sanitizeTelegramError(wrapped.message),
                    },
                },
                'TelegramService',
            );
            throw wrapped;
        }
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
        if (err instanceof TelegramTransientError || err instanceof TelegramPermanentError) {
            const mappedReason = this.mapFailureReason(err.reason);
            return {
                canAccessChat: false,
                isAdmin: false,
                reason: mappedReason,
                telegramError: this.sanitizeTelegramError(err.message),
                retryAfterSeconds: null,
            };
        }
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

    private mapFailureReason(reason: TelegramFailureReason): TelegramCheckReason {
        switch (reason) {
            case 'RATE_LIMIT':
                return TelegramCheckReason.RATE_LIMIT;
            case 'NETWORK':
            case 'TIMEOUT':
            case 'BREAKER_OPEN':
                return TelegramCheckReason.NETWORK;
            case 'CHAT_NOT_FOUND':
                return TelegramCheckReason.CHAT_NOT_FOUND;
            case 'BOT_NOT_ADMIN':
                return TelegramCheckReason.BOT_NOT_ADMIN;
            case 'BOT_KICKED':
                return TelegramCheckReason.BOT_KICKED;
            case 'UNKNOWN':
            default:
                return TelegramCheckReason.UNKNOWN;
        }
    }

    async checkBotAdmin(channelId: string): Promise<TelegramCheckResult> {
        try {
            const admins = await this.executeTelegramAction(
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

        let response: { message_id?: number };

        if (creative.contentType === 'text') {
            const text = String(sendPayload?.text ?? '');
            if (!text.trim()) throw new Error('Creative text payload missing');
            response = await this.executeTelegramAction('sendMessage', () =>
                this.bot.telegram.sendMessage(telegramChannelId, text),
            );
        } else if (creative.contentType === 'image') {
            const imageUrl = String(sendPayload?.url ?? '');
            if (!imageUrl.trim()) throw new Error('Creative image payload missing');
            response = await this.executeTelegramAction('sendPhoto', () =>
                this.bot.telegram.sendPhoto(telegramChannelId, imageUrl, {
                    caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                }),
            );
        } else if (creative.contentType === 'video') {
            const videoUrl = String(sendPayload?.url ?? '');
            if (!videoUrl.trim()) throw new Error('Creative video payload missing');
            response = await this.executeTelegramAction('sendVideo', () =>
                this.bot.telegram.sendVideo(telegramChannelId, videoUrl, {
                    caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                }),
            );
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
    }
}