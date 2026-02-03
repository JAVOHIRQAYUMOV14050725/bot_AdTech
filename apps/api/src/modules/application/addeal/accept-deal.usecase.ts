import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { DealState, TransitionActor } from '@/modules/domain/contracts';

import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class AcceptDealUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        adDealId: string;
        acceptedAt?: Date;
        actor?: TransitionActor;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.accepted) {
                return adDeal;
            }

            if (adDeal.status !== DealState.escrow_locked) {
                throw new BadRequestException(
                    `AdDeal cannot be accepted from status ${adDeal.status}`,
                );
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.accepted,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:accept`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [],
                });
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const accepted = domain.accept(params.acceptedAt).toSnapshot();

            const updated = await tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: accepted.status,
                    acceptedAt: accepted.acceptedAt,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.publisherId,
                    action: 'addeal_accepted',
                    metadata: {
                        adDealId: adDeal.id,
                        status: accepted.status,
                        acceptedAt: accepted.acceptedAt,
                    },
                },
            });

            return updated;
        });
    }
}
