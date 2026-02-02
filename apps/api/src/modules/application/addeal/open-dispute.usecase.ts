import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
import { Dispute } from '@/modules/domain/dispute/dispute.aggregate';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class OpenDisputeUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        adDealId: string;
        openedBy: string;
        reason: string;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            const existing = await tx.dispute.findUnique({
                where: { adDealId: adDeal.id },
            });

            if (existing) {
                if (existing.status === 'open') {
                    return existing;
                }
                throw new BadRequestException('Dispute already resolved');
            }

            if (
                ![
                    AdDealStatus.escrow_locked,
                    AdDealStatus.accepted,
                    AdDealStatus.proof_submitted,
                ].includes(adDeal.status as AdDealStatus)
            ) {
                throw new BadRequestException(
                    `AdDeal cannot be disputed from status ${adDeal.status}`,
                );
            }

            const dispute = Dispute.open({
                id: randomUUID(),
                adDealId: adDeal.id,
                openedBy: params.openedBy,
                reason: params.reason,
            }).toSnapshot();

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const disputed = domain.dispute().toSnapshot();

            await tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: disputed.status,
                    disputedAt: disputed.disputedAt,
                },
            });

            return tx.dispute.create({
                data: {
                    id: dispute.id,
                    adDealId: dispute.adDealId,
                    openedBy: dispute.openedBy,
                    reason: dispute.reason,
                    status: dispute.status,
                    createdAt: dispute.createdAt,
                },
            });
        });
    }
}