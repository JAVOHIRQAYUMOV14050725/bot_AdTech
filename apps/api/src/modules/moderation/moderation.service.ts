import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { SchedulerService } from '@/modules/scheduler/scheduler.service';
import { AuditService } from '@/modules/audit/audit.service';
import { assertCampaignTargetTransition } from '@/modules/lifecycle/lifecycle';

@Injectable()
export class ModerationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
        private readonly schedulerService: SchedulerService,
        private readonly auditService: AuditService,
    ) { }

    async listPending() {
        return this.prisma.campaignTarget.findMany({
            where: { status: 'submitted' },
            include: {
                campaign: { include: { creatives: true } },
                channel: true,
            },
            orderBy: { scheduledAt: 'asc' },
        });
    }

    async approve(targetId: string, adminId: string) {
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: { postJob: true },
        });

        if (!target) {
            throw new NotFoundException('Campaign target not found');
        }

        if (target.status === 'approved' && target.postJob) {
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

            if (fresh.status !== 'submitted') {
                throw new BadRequestException('Target not submitted');
            }

            assertCampaignTargetTransition({
                campaignTargetId: targetId,
                from: fresh.status,
                to: 'approved',
                actor: 'admin',
                correlationId: targetId,
            });

            const updatedTarget = await tx.campaignTarget.update({
                where: { id: targetId },
                data: {
                    status: 'approved',
                    moderatedBy: adminId,
                    moderatedAt: new Date(),
                    moderationReason: null,
                },
            });

            const postJob = await tx.postJob.create({
                data: {
                    campaignTargetId: targetId,
                    executeAt: updatedTarget.scheduledAt,
                    status: 'queued',
                },
            });

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

            return { target: updatedTarget, postJob };
        });

        await this.schedulerService.enqueuePost(
            result.postJob.id,
            result.postJob.executeAt,
        );

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

        if (target.status !== 'submitted') {
            throw new BadRequestException('Target not submitted');
        }

        assertCampaignTargetTransition({
            campaignTargetId: targetId,
            from: target.status,
            to: 'rejected',
            actor: 'admin',
            correlationId: targetId,
        });

        const updated = await this.prisma.campaignTarget.update({
            where: { id: targetId },
            data: {
                status: 'rejected',
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

        return updated;
    }
}