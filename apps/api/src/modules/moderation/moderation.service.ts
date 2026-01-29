import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { SchedulerService } from '@/modules/scheduler/scheduler.service';
import { AuditService } from '@/modules/audit/audit.service';
import { assertCampaignTargetTransition } from '@/modules/lifecycle/lifecycle';
import {
    AdCreative,
    Campaign,
    CampaignTarget,
    Channel,
    CampaignTargetStatus,
    CampaignStatus,
    ChannelStatus,
    PostJob,
    PostJobStatus,
    Prisma,
} from '@prisma/client';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { ConfigService, ConfigType } from '@nestjs/config';
import appConfig from '@/config/app.config';

@Injectable()
export class ModerationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
        private readonly schedulerService: SchedulerService,
        private readonly auditService: AuditService,
        private readonly configService: ConfigService,
    ) { }

    private mapChannel(channel: Channel) {
        return sanitizeForJson({
            id: channel.id,
            telegramChannelId: channel.telegramChannelId,
            title: channel.title,
            username: channel.username,
            category: channel.category,
            subscriberCount: channel.subscriberCount,
            avgViews: channel.avgViews,
            cpm: channel.cpm,
            status: channel.status,
            createdAt: channel.createdAt,
            deletedAt: channel.deletedAt,
            ownerId: channel.ownerId,
        });
    }

    private mapCreative(creative: AdCreative) {
        return sanitizeForJson({
            id: creative.id,
            campaignId: creative.campaignId,
            contentType: creative.contentType,
            contentPayload: creative.contentPayload,
            approvedBy: creative.approvedBy,
            approvedAt: creative.approvedAt,
        });
    }

    private mapCampaign(campaign: Campaign & { creatives?: AdCreative[] }) {
        return sanitizeForJson({
            id: campaign.id,
            advertiserId: campaign.advertiserId,
            name: campaign.name,
            totalBudget: campaign.totalBudget,
            spentBudget: campaign.spentBudget,
            status: campaign.status,
            startAt: campaign.startAt,
            endAt: campaign.endAt,
            createdAt: campaign.createdAt,
            creatives: campaign.creatives?.map((creative) =>
                this.mapCreative(creative),
            ),
        });
    }

    private mapPostJob(postJob?: PostJob | null) {
        if (!postJob) {
            return null;
        }

        return sanitizeForJson({
            id: postJob.id,
            campaignTargetId: postJob.campaignTargetId,
            executeAt: postJob.executeAt,
            attempts: postJob.attempts,
            status: postJob.status,
            lastError: postJob.lastError,
        });
    }

    private mapTarget(
        target: CampaignTarget & {
            campaign?: Campaign & { creatives?: AdCreative[] };
            channel?: Channel;
            postJob?: PostJob | null;
        },
    ) {
        return sanitizeForJson({
            id: target.id,
            campaignId: target.campaignId,
            channelId: target.channelId,
            price: target.price,
            scheduledAt: target.scheduledAt,
            status: target.status,
            moderatedBy: target.moderatedBy,
            moderatedAt: target.moderatedAt,
            moderationReason: target.moderationReason,
            campaign: target.campaign
                ? this.mapCampaign(target.campaign)
                : undefined,
            channel: target.channel ? this.mapChannel(target.channel) : undefined,
            postJob: target.postJob ? this.mapPostJob(target.postJob) : undefined,
        });
    }

    async listPending() {
        const targets = await this.prisma.campaignTarget.findMany({
            where: { status: CampaignTargetStatus.submitted },
            include: {
                campaign: { include: { creatives: true } },
                channel: true,
            },
            orderBy: { scheduledAt: 'asc' },
        });

        return targets.map((target) => this.mapTarget(target));
    }
    async approve(targetId: string, adminId: string) {
        // ✅ Fast-path idempotency (outside tx) — optional but useful
        const initial = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: { postJob: true },
        });

        if (!initial) throw new NotFoundException('Campaign target not found');

        if (initial.status === CampaignTargetStatus.approved && initial.postJob) {
            return {
                ok: true,
                targetId,
                postJobId: initial.postJob.id,
                alreadyApproved: true,
            };
        }

        const result = await this.prisma.$transaction(async (tx) => {
            // =========================================================
            // 0) HARD ROW LOCK (the real fix vs updateMany(no-op))
            // =========================================================
            // Locks the campaignTarget row so approve/reject cannot race.
            // If id doesn't exist, lock returns empty result; we still re-fetch below.
            await tx.$queryRaw`
      SELECT id
      FROM "CampaignTarget"
      WHERE id = ${targetId}
      FOR UPDATE
    `;

            // =========================================================
            // 1) Fetch fresh state (single source of truth)
            // =========================================================
            const fresh = await tx.campaignTarget.findUnique({
                where: { id: targetId },
                include: {
                    campaign: { include: { creatives: true } },
                    channel: true,
                    postJob: true,
                },
            });

            if (!fresh) throw new NotFoundException('Campaign target not found');

            // =========================================================
            // 2) Idempotency: if postJob exists -> return without changes
            // =========================================================
            // If another tx already created job, we’re done.
            if (fresh.postJob) {
                return {
                    postJob: fresh.postJob,
                    created: false,
                    alreadyApproved: fresh.status === CampaignTargetStatus.approved,
                };
            }

            // =========================================================
            // 3) Validate status / preconditions (AFTER lock)
            // =========================================================
            if (fresh.status !== CampaignTargetStatus.submitted) {
                // If it’s approved but postJob missing => inconsistent state; refuse loudly
                // (or you can repair here by creating postJob + enqueue).
                if (fresh.status === CampaignTargetStatus.approved) {
                    throw new BadRequestException(
                        'Target is approved but has no postJob (inconsistent state)',
                    );
                }

                throw new BadRequestException(
                    `Target cannot be approved from status ${fresh.status}`,
                );
            }

            if (!fresh.campaign) throw new NotFoundException('Campaign not found');

            if (fresh.campaign.status !== CampaignStatus.active) {
                throw new BadRequestException(
                    `Campaign ${fresh.campaignId} must be active (current: ${fresh.campaign.status})`,
                );
            }

            if (!fresh.campaign.creatives?.length) {
                throw new BadRequestException('Campaign has no creatives');
            }

            if (!fresh.channel) throw new NotFoundException('Channel not found');

            if (fresh.channel.status !== ChannelStatus.approved) {
                throw new BadRequestException('Channel must be approved');
            }

            const app = this.configService.getOrThrow<ConfigType<typeof appConfig>>(
                appConfig.KEY,
                { infer: true },
            );
            const minLeadMs = app.campaignTargetMinLeadMs;
            if (fresh.scheduledAt.getTime() < Date.now() + minLeadMs) {
                throw new BadRequestException('scheduledAt must be in the future');
            }

            // FSM validation
            assertCampaignTargetTransition({
                campaignTargetId: targetId,
                from: fresh.status,
                to: CampaignTargetStatus.approved,
                actor: 'admin',
                correlationId: targetId,
            });

            // =========================================================
            // 4) APPROVE write first (PaymentsService depends on status)
            // =========================================================
            const approvedTarget = await tx.campaignTarget.update({
                where: { id: targetId },
                data: {
                    status: CampaignTargetStatus.approved,
                    moderatedBy: adminId,
                    moderatedAt: new Date(),
                    moderationReason: null,
                },
            });

            // =========================================================
            // 5) Hold escrow ATOMIC (same tx) — MUST BE IDEMPOTENT
            // =========================================================
            await this.paymentsService.holdEscrow(targetId, {
                transaction: tx,
                actor: 'admin',
                correlationId: targetId,
            });

            // =========================================================
            // 6) Create PostJob idempotently (unique on campaignTargetId)
            // =========================================================
            let postJob: PostJob;
            let created = true;

            try {
                postJob = await tx.postJob.create({
                    data: {
                        campaignTargetId: targetId,
                        executeAt: fresh.scheduledAt,
                        status: PostJobStatus.queued,
                    },
                });
            } catch (err) {
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                    // Another tx created it first — read and return
                    const existing = await tx.postJob.findUnique({
                        where: { campaignTargetId: targetId },
                    });
                    if (!existing) throw err;

                    postJob = existing;
                    created = false;
                } else {
                    throw err;
                }
            }

            // =========================================================
            // 7) Audit (only when we actually created the job)
            // =========================================================
            if (created) {
                await this.auditService.log({
                    userId: adminId,
                    action: 'moderation_approved',
                    metadata: { targetId, postJobId: postJob.id },
                });
            }

            return { target: approvedTarget, postJob, created, alreadyApproved: false };
        });

        if (result.created) {
            await this.schedulerService.enqueuePost(result.postJob.id, result.postJob.executeAt);
        }

        return {
            ok: true,
            targetId,
            postJobId: result.postJob.id,
            alreadyApproved: result.alreadyApproved ?? false,
        };
    }

    async reject(targetId: string, adminId: string, reason?: string) {
        // ✅ Optional fast-path read (good UX). Real safety is inside tx.
        const initial = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            select: { id: true, status: true },
        });

        if (!initial) throw new NotFoundException('Campaign target not found');

        // If already rejected, return idempotently (outside tx)
        if (initial.status === CampaignTargetStatus.rejected) {
            return {
                ok: true,
                targetId,
                alreadyRejected: true,
            };
        }

        const result = await this.prisma.$transaction(async (tx) => {
            // =========================================================
            // 0) HARD ROW LOCK (approve/reject race killer)
            // =========================================================
            await tx.$queryRaw`
      SELECT id
      FROM "CampaignTarget"
      WHERE id = ${targetId}
      FOR UPDATE
    `;

            // =========================================================
            // 1) Fetch fresh state (include postJob for safety)
            // =========================================================
            const fresh = await tx.campaignTarget.findUnique({
                where: { id: targetId },
                include: { postJob: true },
            });

            if (!fresh) throw new NotFoundException('Campaign target not found');

            // =========================================================
            // 2) Idempotency / conflict rules
            // =========================================================
            if (fresh.status === CampaignTargetStatus.rejected) {
                return { target: fresh, alreadyRejected: true, changed: false };
            }

            // If approved (or has postJob), rejecting must be forbidden
            // because escrow may already be held and job scheduled.
            if (
                fresh.status === CampaignTargetStatus.approved ||
                fresh.postJob
            ) {
                throw new BadRequestException(
                    `Target cannot be rejected from status ${fresh.status}`,
                );
            }

            if (fresh.status !== CampaignTargetStatus.submitted) {
                throw new BadRequestException(
                    `Target cannot be rejected from status ${fresh.status}`,
                );
            }

            // FSM validation
            assertCampaignTargetTransition({
                campaignTargetId: targetId,
                from: fresh.status,
                to: CampaignTargetStatus.rejected,
                actor: 'admin',
                correlationId: targetId,
            });

            // =========================================================
            // 3) Write reject
            // =========================================================
            const updated = await tx.campaignTarget.update({
                where: { id: targetId },
                data: {
                    status: CampaignTargetStatus.rejected,
                    moderatedBy: adminId,
                    moderatedAt: new Date(),
                    moderationReason: reason?.trim() ? reason.trim() : null,
                },
            });

            // =========================================================
            // 4) Audit (only if we actually changed state)
            // =========================================================
            await this.auditService.log({
                userId: adminId,
                action: 'moderation_rejected',
                metadata: { targetId, reason: reason?.trim() ? reason.trim() : null },
            });

            return { target: updated, alreadyRejected: false, changed: true };
        });

        // Keep response consistent with your other handlers
        if (result.alreadyRejected) {
            return {
                ok: true,
                targetId,
                alreadyRejected: true,
            };
        }

        return this.mapTarget(result.target);
    }

}