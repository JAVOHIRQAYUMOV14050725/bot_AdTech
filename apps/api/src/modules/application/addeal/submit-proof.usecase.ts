import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { DealState, TransitionActor } from '@/modules/domain/contracts';
import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class SubmitProofUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        adDealId: string;
        proofPayload: Prisma.InputJsonValue;
        submittedAt?: Date;
        actor?: TransitionActor;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.proof_submitted) {
                return adDeal;
            }

            if (adDeal.status !== DealState.accepted) {
                throw new BadRequestException(
                    `AdDeal cannot submit proof from status ${adDeal.status}`,
                );
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.proof_submitted,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:submit_proof`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [],
                });
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const proofed = domain
                .submitProof(params.submittedAt)
                .toSnapshot();

            const updated = await tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: proofed.status,
                    proofSubmittedAt: proofed.proofSubmittedAt,
                    proofPayload: params.proofPayload,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.publisherId,
                    action: 'addeal_proof_submitted',
                    metadata: {
                        adDealId: adDeal.id,
                        proofSubmittedAt: proofed.proofSubmittedAt,
                    },
                },
            });

            return updated;
        });
    }
}