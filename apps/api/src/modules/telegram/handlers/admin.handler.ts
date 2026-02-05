import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { telegramSafeErrorMessageWithCorrelation } from '@/modules/telegram/telegram-error.util';

@Injectable()
export class AdminHandler {
    private readonly logger = new Logger(AdminHandler.name);

    constructor(
        private readonly backendClient: TelegramBackendClient,
    ) { }

    // 🔐 RBAC CHECK
    private async assertAdmin(ctx: Context) {
        const telegramId = ctx.from?.id;
        if (!telegramId) throw new ForbiddenException();
        return telegramId;
    }

    // ===============================
    // FORCE RELEASE
    // ===============================
    async forceRelease(ctx: Context, campaignTargetId: string) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminForceRelease({
                telegramId: adminTelegramId.toString(),
                campaignTargetId,
            });
            await ctx.reply(
                `⏳ Escrow release queued for manual review.\nTarget: ${campaignTargetId}`,
            );
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
        }
    }

    // ===============================
    // FORCE REFUND
    // ===============================
    async forceRefund(
        ctx: Context,
        campaignTargetId: string,
        reason = 'admin_force',
    ) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminForceRefund({
                telegramId: adminTelegramId.toString(),
                campaignTargetId,
                reason,
            });
            await ctx.reply(
                `⏳ Escrow refund queued for manual review.\nTarget: ${campaignTargetId}\nReason: ${reason}`,
            );
        } catch (err) {
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
        }
    }

    // ===============================
    // RETRY POST
    // ===============================
    async retryPost(ctx: Context, postJobId: string) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminRetryPost({
                telegramId: adminTelegramId.toString(),
                postJobId,
            });
            await ctx.reply(`♻️ PostJob re-queued\nID: ${postJobId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
        }
    }

    // ===============================
    // FREEZE CAMPAIGN
    // ===============================
    async freezeCampaign(ctx: Context, campaignId: string) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminFreezeCampaign({
                telegramId: adminTelegramId.toString(),
                campaignId,
            });
            await ctx.reply(`⛔ Campaign frozen\nID: ${campaignId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
        }
    }

    async unfreezeCampaign(ctx: Context, campaignId: string) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminUnfreezeCampaign({
                telegramId: adminTelegramId.toString(),
                campaignId,
            });
            await ctx.reply(`▶️ Campaign resumed\nID: ${campaignId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = telegramSafeErrorMessageWithCorrelation(err);
            await ctx.reply(`❌ ${message}`);
        }
    }
}
