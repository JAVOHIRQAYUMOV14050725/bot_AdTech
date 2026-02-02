import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class SubmitProofUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        adDealId: string;
        proofPayload: Prisma.InputJsonValue;
        submittedAt?: Date;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === AdDealStatus.proof_submitted) {
                return adDeal;
            }

            if (adDeal.status !== AdDealStatus.accepted) {
                throw new BadRequestException(
                    `AdDeal cannot submit proof from status ${adDeal.status}`,
                );
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const proofed = domain
                .submitProof(params.submittedAt)
                .toSnapshot();

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: proofed.status,
                    proofSubmittedAt: proofed.proofSubmittedAt,
                    proofPayload: params.proofPayload,
                },
            });
        });
    }
}
