import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { Dispute } from '@/modules/domain/dispute/dispute.aggregate';
import { DisputeResolution, DisputeStatus } from '@/modules/domain/dispute/dispute.types';
import { SettleAdDealUseCase } from './settle-addeal.usecase';
import { RefundAdDealUseCase } from './refund-addeal.usecase';

@Injectable()
export class ResolveDisputeUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly settleAdDeal: SettleAdDealUseCase,
        private readonly refundAdDeal: RefundAdDealUseCase,
    ) { }

    async execute(params: {
        disputeId: string;
        adminId: string;
        resolution: DisputeResolution;
        reason: string;
        metadata?: Prisma.InputJsonValue;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const admin = await tx.user.findUnique({
                where: { id: params.adminId },
            });

            if (!admin) {
                throw new NotFoundException('Admin not found');
            }

            if (
                admin.role !== UserRole.admin
                && admin.role !== UserRole.super_admin
            ) {
                throw new BadRequestException('Admin privileges required');
            }

            const disputeRecord = await tx.dispute.findUnique({
                where: { id: params.disputeId },
            });

            if (!disputeRecord) {
                throw new NotFoundException('Dispute not found');
            }

            if (disputeRecord.status === DisputeStatus.resolved) {
                return disputeRecord;
            }

            const dispute = Dispute.rehydrate({
                id: disputeRecord.id,
                adDealId: disputeRecord.adDealId,
                openedBy: disputeRecord.openedBy,
                reason: disputeRecord.reason,
                status: disputeRecord.status as DisputeStatus,
                resolution: disputeRecord.resolution as DisputeResolution | null,
                resolvedBy: disputeRecord.resolvedBy,
                resolvedAt: disputeRecord.resolvedAt,
                createdAt: disputeRecord.createdAt,
            }).resolve({
                resolution: params.resolution,
                resolvedBy: admin.id,
            });

            if (params.resolution === DisputeResolution.release) {
                await this.settleAdDeal.execute({
                    adDealId: disputeRecord.adDealId,
                    actor: 'admin',
                    transaction: tx,
                });
            } else if (params.resolution === DisputeResolution.refund) {
                await this.refundAdDeal.execute({
                    adDealId: disputeRecord.adDealId,
                    actor: 'admin',
                    transaction: tx,
                });
            } else {
                throw new BadRequestException('Unsupported dispute resolution');
            }

            const resolvedSnapshot = dispute.toSnapshot();

            const updated = await tx.dispute.update({
                where: { id: disputeRecord.id },
                data: {
                    status: resolvedSnapshot.status,
                    resolution: resolvedSnapshot.resolution,
                    resolvedBy: resolvedSnapshot.resolvedBy,
                    resolvedAt: resolvedSnapshot.resolvedAt,
                },
            });

            await tx.disputeAuditLog.create({
                data: {
                    disputeId: disputeRecord.id,
                    adminId: admin.id,
                    action: 'RESOLVE',
                    reason: params.reason,
                    metadata: params.metadata ?? Prisma.DbNull,
                },
            });

            return updated;
        });
    }
}