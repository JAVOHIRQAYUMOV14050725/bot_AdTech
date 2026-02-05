import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';
import { extractTelegramErrorMeta, mapBackendErrorToTelegramMessage } from '@/modules/telegram/telegram-error.util';
import { replySafe } from '@/modules/telegram/telegram-safe-text.util';

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
            await replySafe(
                ctx,
                `⏳ Escrow release queued for manual review.\nTarget: ${campaignTargetId}`,
            );
        } catch (err) {
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_force_release_failed',
                campaignTargetId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
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
            await replySafe(
                ctx,
                `⏳ Escrow refund queued for manual review.\nTarget: ${campaignTargetId}\nReason: ${reason}`,
            );
        } catch (err) {
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_force_refund_failed',
                campaignTargetId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
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
            await replySafe(ctx, `♻️ PostJob re-queued\nID: ${postJobId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_retry_post_failed',
                postJobId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
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
            await replySafe(ctx, `⛔ Campaign frozen\nID: ${campaignId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_freeze_campaign_failed',
                campaignId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
        }
    }

    async unfreezeCampaign(ctx: Context, campaignId: string) {
        const adminTelegramId = await this.assertAdmin(ctx);
        try {
            await this.backendClient.adminUnfreezeCampaign({
                telegramId: adminTelegramId.toString(),
                campaignId,
            });
            await replySafe(ctx, `▶️ Campaign resumed\nID: ${campaignId}`);
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            const message = mapBackendErrorToTelegramMessage(err);
            const { code, correlationId } = extractTelegramErrorMeta(err);
            this.logger.error({
                event: 'telegram_unfreeze_campaign_failed',
                campaignId,
                code,
                correlationId,
                error: message,
            });
            await replySafe(ctx, message);
        }
    }
}