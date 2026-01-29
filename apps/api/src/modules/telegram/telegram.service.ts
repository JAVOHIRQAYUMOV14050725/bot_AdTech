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
import { ConfigService } from '@nestjs/config';
import { EnvVars } from '@/config/env.schema';
import CircuitBreaker from 'opossum';
import { withTimeout } from '@/common/utils/timeout';
import {
    TelegramCircuitOpenError,
    TelegramPermanentError,
    TelegramTimeoutError,
    TelegramTransientError,
} from './telegram.errors';
import { RequestContext } from '@/common/context/request-context';

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
    private readonly telegramBreaker: CircuitBreaker<() => Promise<unknown>, unknown>;
    private readonly requestTimeoutMs: number;
    private readonly maxAttempts: number;
    private readonly baseDelayMs: number;
    private readonly breakerFailureThreshold: number;
    private readonly breakerResetMs: number;
    private readonly isProduction: boolean;

    constructor(
        private readonly prisma: PrismaService,
        private readonly adminHandler: AdminHandler,
        private readonly configService: ConfigService<EnvVars>,
          @Inject('LOGGER') private readonly logger: LoggerService,
    ) {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN', { infer: true });
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
        this.bot = new Telegraf(token);

        this.requestTimeoutMs =
            this.configService.get<number>('TELEGRAM_REQUEST_TIMEOUT_MS', { infer: true }) ?? 25000;
        this.maxAttempts =
            this.configService.get<number>('TELEGRAM_SEND_MAX_ATTEMPTS', { infer: true }) ?? 3;
        this.baseDelayMs =
            this.configService.get<number>('TELEGRAM_SEND_BASE_DELAY_MS', { infer: true }) ?? 1000;
        this.breakerFailureThreshold =
            this.configService.get<number>('TELEGRAM_BREAKER_FAILURE_THRESHOLD', { infer: true }) ?? 5;
        this.breakerResetMs =
            this.configService.get<number>('TELEGRAM_BREAKER_RESET_MS', { infer: true }) ?? 60000;
        this.isProduction = this.configService.get<string>('NODE_ENV', { infer: true }) === 'production';

        this.telegramBreaker = new CircuitBreaker(
            async (fn: () => Promise<unknown>) => fn(),
            {
                timeout: this.requestTimeoutMs + 1000,
                errorThresholdPercentage: 100,
                volumeThreshold: this.breakerFailureThreshold,
                resetTimeout: this.breakerResetMs,
            },
        );
        this.telegramBreaker.on('open', () => {
            this.logger.warn(
                {
                    event: 'telegram_breaker_open',
                    alert: true,
                },
                'TelegramService',
            );
        });
        this.telegramBreaker.on('halfOpen', () => {
            this.logger.warn(
                {
                    event: 'telegram_breaker_half_open',
                },
                'TelegramService',
            );
        });
        this.telegramBreaker.on('close', () => {
            this.logger.warn(
                {
                    event: 'telegram_breaker_close',
                },
                'TelegramService',
            );
        });
    }

    async onModuleInit() {
        const smokeTestEnabled =
            this.configService.get<boolean>('ENABLE_TELEGRAM_SMOKE_TEST', { infer: true }) ?? false;
        if (smokeTestEnabled && !this.isProduction) {
            void this.sendTestToMyChannel();
        }

        this.registerAdminCommands();

        const autostart =
            this.configService.get<boolean>('TELEGRAM_AUTOSTART', { infer: true }) ?? false;
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
        const channel = this.configService.get<string>('TELEGRAM_TEST_CHANNEL', { infer: true });
        if (!channel) {
            this.logger.warn({
                event: 'telegram_smoke_test_channel_not_set',
            },
                'TelegramService'
            );
            return;
        }
        await this.executeTelegramAction(
            'sendMessage',
            () => this.bot.telegram.sendMessage(channel, '✅ bot startup test'),
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
        const enableDebug =
            this.configService.get<boolean>('ENABLE_DEBUG', { infer: true }) ?? false;
        if (!this.isProduction || enableDebug) {
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
        const me = await this.executeTelegramAction(
            'getMe',
            () => this.bot.telegram.getMe(),
        );
        this.botId = me.id;
        return me.id;
    }

    async checkConnection(): Promise<{ id: number; username?: string }> {
        const me = await this.executeTelegramAction(
            'getMe',
            () => this.bot.telegram.getMe(),
        );
        this.botId = me.id;
        return { id: me.id, username: me.username };
    }

    private getCorrelationId(context?: { correlationId?: string }) {
        return context?.correlationId ?? RequestContext.getCorrelationId();
    }

    private buildLogContext(context?: {
        entityType?: string;
        entityId?: string;
        correlationId?: string;
    }) {
        return {
            entityType: context?.entityType,
            entityId: context?.entityId,
            correlationId: this.getCorrelationId(context),
        };
    }

    private isBreakerOpenError(err: unknown): boolean {
        if (!err || typeof err !== 'object') {
            return false;
        }
        const code = (err as { code?: string }).code;
        return code === 'EOPENBREAKER' || code === 'EHALFOPEN';
    }

    private async executeTelegramAction<T>(
        action: string,
        fn: () => Promise<T>,
        context?: { entityType?: string; entityId?: string; correlationId?: string },
    ): Promise<T> {
        const logContext = this.buildLogContext(context);
        this.logger.log(
            {
                event: 'telegram_call_start',
                action,
                ...logContext,
            },
            'TelegramService',
        );

        try {
            const result = await this.telegramBreaker.fire(() =>
                withTimeout(
                    (_signal) => fn(),
                    {
                        timeoutMs: this.requestTimeoutMs,
                        errorFactory: (timeoutMs) =>
                            new TelegramTimeoutError(
                                `${action} timed out`,
                                timeoutMs,
                            ),
                    },
                ),
            );

            this.logger.log(
                {
                    event: 'telegram_call_success',
                    action,
                    ...logContext,
                },
                'TelegramService',
            );
            return result as T;
        } catch (err) {
            if (err instanceof TelegramTimeoutError) {
                this.logger.warn(
                    {
                        event: 'telegram_call_timeout',
                        action,
                        alert: true,
                        ...logContext,
                    },
                    'TelegramService',
                );
                throw err;
            }

            if (this.isBreakerOpenError(err)) {
                const circuitError = new TelegramCircuitOpenError(
                    'Telegram circuit breaker open',
                    err,
                );
                this.logger.warn(
                    {
                        event: 'telegram_breaker_open',
                        alert: true,
                        action,
                        ...logContext,
                    },
                    'TelegramService',
                );
                throw circuitError;
            }

            this.logger.warn(
                {
                    event: 'telegram_call_failed',
                    action,
                    alert: false,
                    error: this.sanitizeTelegramError(
                        err instanceof Error ? err.message : String(err),
                    ),
                    ...logContext,
                },
                'TelegramService',
            );
            throw err;
        }
    }

    private async withTelegramRetry<T>(action: string, fn: () => Promise<T>): Promise<T> {
        const maxAttempts = this.maxAttempts;
        const baseDelayMs = this.baseDelayMs;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await fn();
            } catch (err) {
                if (err instanceof TelegramCircuitOpenError) {
                    throw err;
                }
                if (err instanceof TelegramPermanentError) {
                    throw err;
                }
                const retryAfterSeconds =
                    err instanceof TelegramTransientError
                        ? err.retryAfterSeconds ?? undefined
                        : (err as { response?: { parameters?: { retry_after?: number } } })?.response?.parameters?.retry_after
                        ?? (err as { parameters?: { retry_after?: number } })?.parameters?.retry_after;

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
            || lowerMessage.includes('forbidden')
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

    private toTelegramError(action: string, err: unknown): Error {
        if (err instanceof TelegramTimeoutError
            || err instanceof TelegramCircuitOpenError
            || err instanceof TelegramPermanentError
            || err instanceof TelegramTransientError) {
            return err;
        }

        const classified = this.classifyTelegramError(err);
        const message = `${action} failed: ${classified.reason}`;

        if (
            classified.reason === TelegramCheckReason.CHAT_NOT_FOUND
            || classified.reason === TelegramCheckReason.BOT_KICKED
            || classified.reason === TelegramCheckReason.BOT_NOT_ADMIN
        ) {
            return new TelegramPermanentError(message, err);
        }

        if (
            classified.reason === TelegramCheckReason.RATE_LIMIT
            || classified.reason === TelegramCheckReason.NETWORK
        ) {
            return new TelegramTransientError(
                message,
                classified.retryAfterSeconds,
                err,
            );
        }

        return new TelegramTransientError(
            message,
            classified.retryAfterSeconds,
            err,
        );
    }

    async checkBotAdmin(channelId: string): Promise<TelegramCheckResult> {
        try {
            const admins = await this.withTelegramRetry(
                'getChatAdministrators',
                () => this.executeTelegramAction(
                    'getChatAdministrators',
                    () => this.bot.telegram.getChatAdministrators(channelId),
                    { entityType: 'channel', entityId: channelId },
                ),
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
            if (err instanceof TelegramTimeoutError || err instanceof TelegramCircuitOpenError) {
                return {
                    canAccessChat: false,
                    isAdmin: false,
                    reason: TelegramCheckReason.NETWORK,
                    telegramError: this.sanitizeTelegramError(
                        err instanceof Error ? err.message : String(err),
                    ),
                    retryAfterSeconds: null,
                };
            }
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

        const response = await this.withTelegramRetry('sendCampaignPost', async () => {
            try {
                if (creative.contentType === 'text') {
                    const text = String(sendPayload?.text ?? '');
                    if (!text.trim()) throw new Error('Creative text payload missing');
                    return await this.executeTelegramAction(
                        'sendMessage',
                        () => this.bot.telegram.sendMessage(telegramChannelId, text),
                        { entityType: 'post_job', entityId: postJobId, correlationId: postJobId },
                    );
                }

                if (creative.contentType === 'image') {
                    const imageUrl = String(sendPayload?.url ?? '');
                    if (!imageUrl.trim()) throw new Error('Creative image payload missing');
                    return await this.executeTelegramAction(
                        'sendPhoto',
                        () => this.bot.telegram.sendPhoto(telegramChannelId, imageUrl, {
                            caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                        }),
                        { entityType: 'post_job', entityId: postJobId, correlationId: postJobId },
                    );
                }

                if (creative.contentType === 'video') {
                    const videoUrl = String(sendPayload?.url ?? '');
                    if (!videoUrl.trim()) throw new Error('Creative video payload missing');
                    return await this.executeTelegramAction(
                        'sendVideo',
                        () => this.bot.telegram.sendVideo(telegramChannelId, videoUrl, {
                            caption: typeof sendPayload?.caption === 'string' ? sendPayload.caption : undefined,
                        }),
                        { entityType: 'post_job', entityId: postJobId, correlationId: postJobId },
                    );
                }

                throw new Error('Unsupported creative type');
            } catch (err) {
                throw this.toTelegramError('sendCampaignPost', err);
            }
        });

        const messageId = response?.message_id;

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
