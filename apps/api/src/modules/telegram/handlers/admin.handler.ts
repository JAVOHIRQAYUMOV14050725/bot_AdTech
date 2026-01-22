import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Context } from 'telegraf';
import { EscrowService } from '@/modules/payments/escrow.service';

@Injectable()
export class AdminHandler {
    private readonly logger = new Logger(AdminHandler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly escrowService: EscrowService,
            
    ) { }

    // 🔐 RBAC CHECK
    private async assertAdmin(ctx: Context) {
        const telegramId = ctx.from?.id;
        if (!telegramId) throw new ForbiddenException();

        const user = await this.prisma.user.findUnique({
            where: { telegramId },
        });

        if (!user || user.role !== 'super_admin') {
            throw new ForbiddenException('Admin only command');
        }

        return user;
    }

    // ===============================
    // FORCE RELEASE
    // ===============================
    async forceRelease(ctx: Context, campaignTargetId: string) {
        const admin = await this.assertAdmin(ctx);

        await this.escrowService.release(campaignTargetId);

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_release',
                metadata: { campaignTargetId },
                ipAddress: ctx.from?.username ?? 'telegram',
            },
        });

        await ctx.reply(`✅ Escrow RELEASED\nTarget: ${campaignTargetId}`);
    }

    // ===============================
    // FORCE REFUND
    // ===============================
    async forceRefund(
        ctx: Context,
        campaignTargetId: string,
        reason = 'admin_force',
    ) {
        const admin = await this.assertAdmin(ctx);

        await this.escrowService.refund(campaignTargetId, reason);

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_refund',
                metadata: { campaignTargetId, reason },
                ipAddress: ctx.from?.username ?? 'telegram',
            },
        });

        await ctx.reply(
            `🔁 Escrow REFUNDED\nTarget: ${campaignTargetId}\nReason: ${reason}`,
        );
    }

    // ===============================
    // RETRY POST
    // ===============================
    async retryPost(ctx: Context, postJobId: string) {
        const admin = await this.assertAdmin(ctx);

        await this.prisma.postJob.update({
            where: { id: postJobId },
            data: {
                status: 'queued',
                lastError: null,
            },
        });

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'retry_post',
                metadata: { postJobId },
            },
        });

        await ctx.reply(`♻️ PostJob re-queued\nID: ${postJobId}`);
    }

    // ===============================
    // FREEZE CAMPAIGN
    // ===============================
    async freezeCampaign(ctx: Context, campaignId: string) {
        const admin = await this.assertAdmin(ctx);

        await this.prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'paused' },
        });

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'freeze_campaign',
                metadata: { campaignId },
            },
        });

        await ctx.reply(`⛔ Campaign frozen\nID: ${campaignId}`);
    }

    async unfreezeCampaign(ctx: Context, campaignId: string) {
        const admin = await this.assertAdmin(ctx);

        await this.prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'active' },
        });

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'unfreeze_campaign',
                metadata: { campaignId },
            },
        });

        await ctx.reply(`▶️ Campaign resumed\nID: ${campaignId}`);
    }
}
