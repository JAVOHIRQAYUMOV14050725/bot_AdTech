import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Telegraf, Context } from 'telegraf';
import { AdminHandler } from './handlers/admin.handler';
import { Prisma } from '@prisma/client';

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
        const postJob = await this.prisma.postJob.findUnique({
            where: { id: postJobId },
            include: {
                campaignTarget: {
                    include: {
                        campaign: { include: { creatives: true } },
                        channel: true,
                    },
                },
                executions: true,
            },
        });

        if (!postJob) {
            throw new Error('PostJob not found');
        }

        const existingExecution = postJob.executions.find(
            (execution) => execution.telegramMessageId,
        );

        if (existingExecution?.telegramMessageId) {
            return {
                ok: true,
                telegramMessageId: Number(existingExecution.telegramMessageId),
            };
        }

        if (postJob.status === 'success') {
            return { ok: true };
        }

        const channelId = postJob.campaignTarget.channel.telegramChannelId;
        const creative = postJob.campaignTarget.campaign.creatives[0];

        if (!creative) {
            throw new Error('Campaign creative not found');
        }

        const sendPayload = creative.contentPayload as Prisma.JsonObject;

        const maxAttempts = Number(
            process.env.TELEGRAM_SEND_MAX_ATTEMPTS ?? 3,
        );
        const baseDelayMs = Number(
            process.env.TELEGRAM_SEND_BASE_DELAY_MS ?? 1000,
        );

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                let response:
                    | { message_id: number }
                    | { message_id?: number };

                if (creative.contentType === 'text') {
                    const text = String(sendPayload?.text ?? '');
                    if (!text.trim()) {
                        throw new Error('Creative text payload missing');
                    }
                    response = await this.bot.telegram.sendMessage(
                        channelId,
                        text,
                    );
                } else if (creative.contentType === 'image') {
                    const imageUrl = String(sendPayload?.url ?? '');
                    if (!imageUrl.trim()) {
                        throw new Error('Creative image payload missing');
                    }
                    response = await this.bot.telegram.sendPhoto(
                        channelId,
                        imageUrl,
                        {
                            caption:
                                typeof sendPayload?.caption === 'string'
                                    ? sendPayload.caption
                                    : undefined,
                        },
                    );
                } else if (creative.contentType === 'video') {
                    const videoUrl = String(sendPayload?.url ?? '');
                    if (!videoUrl.trim()) {
                        throw new Error('Creative video payload missing');
                    }
                    response = await this.bot.telegram.sendVideo(
                        channelId,
                        videoUrl,
                        {
                            caption:
                                typeof sendPayload?.caption === 'string'
                                    ? sendPayload.caption
                                    : undefined,
                        },
                    );
                } else {
                    throw new Error('Unsupported creative type');
                }

                const messageId = response.message_id;

                await this.prisma.postExecutionLog.create({
                    data: {
                        postJobId,
                        telegramMessageId: messageId
                            ? BigInt(messageId)
                            : null,
                        responsePayload: sendPayload,
                    },
                });

                return {
                    ok: true,
                    telegramMessageId: messageId,
                };
            } catch (err) {
                const errorMessage =
                    err instanceof Error ? err.message : String(err);
                this.logger.warn(
                    `Telegram send failed (attempt ${attempt}/${maxAttempts}): ${errorMessage}`,
                );

                if (attempt === maxAttempts) {
                    return { ok: false };
                }

                const backoffMs = baseDelayMs * 2 ** (attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        return { ok: false };
    }
}
