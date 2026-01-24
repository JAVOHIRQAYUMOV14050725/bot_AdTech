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
    PostJob,
    PostJobStatus,
    Prisma,
} from '@prisma/client';
import { sanitizeForJson } from '@/common/serialization/sanitize';

@Injectable()
export class ModerationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
        private readonly schedulerService: SchedulerService,
        private readonly auditService: AuditService,
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
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: { postJob: true },
        });

        if (!target) {
            throw new NotFoundException('Campaign target not found');
        }

        if (target.status === CampaignTargetStatus.approved && target.postJob) {
            return {
                ok: true,
                targetId,
                postJobId: target.postJob.id,
                alreadyApproved: true,
            };
        }

        const result = await this.prisma.$transaction(async (tx) => {
            const fresh = await tx.campaignTarget.findUnique({
                where: { id: targetId },
                include: { postJob: true },
            });

            if (!fresh) {
                throw new NotFoundException('Campaign target not found');
            }

            if (fresh.postJob) {
                return { target: fresh, postJob: fresh.postJob };
            }

            if (fresh.status !== CampaignTargetStatus.submitted) {
                throw new BadRequestException('Target not submitted');
            }

            assertCampaignTargetTransition({
                campaignTargetId: targetId,
                from: fresh.status,
                to: CampaignTargetStatus.approved,
                actor: 'admin',
                correlationId: targetId,
            });

            const updatedTarget = await tx.campaignTarget.update({
                where: { id: targetId },
                data: {
                    status: CampaignTargetStatus.approved,
                    moderatedBy: adminId,
                    moderatedAt: new Date(),
                    moderationReason: null,
                },
            });

            let postJob: PostJob;
            let created = true;
            try {
                postJob = await tx.postJob.create({
                    data: {
                        campaignTargetId: targetId,
                        executeAt: updatedTarget.scheduledAt,
                        status: PostJobStatus.queued,
                    },
                });
            } catch (err) {
                if (
                    err instanceof Prisma.PrismaClientKnownRequestError
                    && err.code === 'P2002'
                ) {
                    const existing = await tx.postJob.findUnique({
                        where: { campaignTargetId: targetId },
                    });
                    if (!existing) {
                        throw err;
                    }
                    postJob = existing;
                    created = false;
                } else {
                    throw err;
                }
            }

            if (created) {
                await this.paymentsService.holdEscrow(targetId, {
                    transaction: tx,
                    actor: 'admin',
                    correlationId: targetId,
                });

                await this.auditService.log({
                    userId: adminId,
                    action: 'moderation_approved',
                    metadata: { targetId, postJobId: postJob.id },
                });
            }

            return { target: updatedTarget, postJob, created };
        });

        if (result.created) {
            await this.schedulerService.enqueuePost(
                result.postJob.id,
                result.postJob.executeAt,
            );
        }

        return {
            ok: true,
            targetId,
            postJobId: result.postJob.id,
        };
    }

    async reject(targetId: string, adminId: string, reason?: string) {
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
        });

        if (!target) {
            throw new NotFoundException('Campaign target not found');
        }

        if (target.status !== CampaignTargetStatus.submitted) {
            throw new BadRequestException('Target not submitted');
        }

        assertCampaignTargetTransition({
            campaignTargetId: targetId,
            from: target.status,
            to: CampaignTargetStatus.rejected,
            actor: 'admin',
            correlationId: targetId,
        });

        const updated = await this.prisma.campaignTarget.update({
            where: { id: targetId },
            data: {
                status: CampaignTargetStatus.rejected,
                moderatedBy: adminId,
                moderatedAt: new Date(),
                moderationReason: reason ?? null,
            },
        });

        await this.auditService.log({
            userId: adminId,
            action: 'moderation_rejected',
            metadata: { targetId, reason: reason ?? null },
        });

        return this.mapTarget(updated);
    }

}