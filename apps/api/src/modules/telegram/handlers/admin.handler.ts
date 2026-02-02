import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Context } from 'telegraf';
import {
    assertCampaignTransition,
    assertPostJobTransition,
} from '@/modules/lifecycle/lifecycle';
import { CampaignStatus, PostJobStatus } from '@prisma/client';
import { TransitionActor, UserRole } from '@/modules/domain/contracts';

@Injectable()
export class AdminHandler {
    private readonly logger = new Logger(AdminHandler.name);

    constructor(
        private readonly prisma: PrismaService,
    ) { }

    // 🔐 RBAC CHECK
    private async assertAdmin(ctx: Context) {
        const telegramId = ctx.from?.id;
        if (!telegramId) throw new ForbiddenException();

        const telegramIdBigInt = BigInt(telegramId);

        const user = await this.prisma.user.findUnique({
            where: { telegramId: telegramIdBigInt },
        });

        if (!user || user.role !== UserRole.super_admin) {
            throw new ForbiddenException('Admin only command');
        }

        return user;
    }

    // ===============================
    // FORCE RELEASE
    // ===============================
    async forceRelease(ctx: Context, campaignTargetId: string) {
        const admin = await this.assertAdmin(ctx);

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_release',
                metadata: {
                    campaignTargetId,
                    status: 'queued_manual_review',
                    requestedVia: 'telegram',
                },
                ipAddress: ctx.from?.username ?? 'telegram',
            },
        });

        await ctx.reply(
            `⏳ Escrow release queued for manual review.\nTarget: ${campaignTargetId}`,
        );
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

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_refund',
                metadata: {
                    campaignTargetId,
                    reason,
                    status: 'queued_manual_review',
                    requestedVia: 'telegram',
                },
                ipAddress: ctx.from?.username ?? 'telegram',
            },
        });

        await ctx.reply(
            `⏳ Escrow refund queued for manual review.\nTarget: ${campaignTargetId}\nReason: ${reason}`,
        );
    }

    // ===============================
    // RETRY POST
    // ===============================
    async retryPost(ctx: Context, postJobId: string) {
        const admin = await this.assertAdmin(ctx);

        const postJob = await this.prisma.postJob.findUnique({
            where: { id: postJobId },
            select: { id: true, status: true },
        });

        if (!postJob) {
            throw new BadRequestException('PostJob not found');
        }

        const transition = assertPostJobTransition({
            postJobId,
            from: postJob.status,
            to: PostJobStatus.queued,
            actor: TransitionActor.admin,
            correlationId: postJobId,
        });

        if (!transition.noop) {
            await this.prisma.postJob.update({
                where: { id: postJobId },
                data: {
                    status: PostJobStatus.queued,
                    lastError: null,
                },
            });
        }

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

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, status: true },
        });

        if (!campaign) {
            throw new BadRequestException('Campaign not found');
        }

        const transition = assertCampaignTransition({
            campaignId,
            from: campaign.status,
            to: CampaignStatus.paused,
            actor: TransitionActor.admin,
            correlationId: campaignId,
        });

        if (!transition.noop) {
            await this.prisma.campaign.update({
                where: { id: campaignId },
                data: { status: CampaignStatus.paused },
            });
        }

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

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, status: true },
        });

        if (!campaign) {
            throw new BadRequestException('Campaign not found');
        }

        const transition = assertCampaignTransition({
            campaignId,
            from: campaign.status,
            to: CampaignStatus.active,
            actor: TransitionActor.admin,
            correlationId: campaignId,
        });

        if (!transition.noop) {
            await this.prisma.campaign.update({
                where: { id: campaignId },
                data: { status: CampaignStatus.active },
            });
        }

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