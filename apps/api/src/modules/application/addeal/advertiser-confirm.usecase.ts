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
export class AdvertiserConfirmUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        adDealId: string;
        confirmedAt?: Date;
        actor?: TransitionActor;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.advertiser_confirmed) {
                return adDeal;
            }

            if (adDeal.status !== DealState.accepted) {
                throw new BadRequestException(
                    `AdDeal cannot be confirmed from status ${adDeal.status}`,
                );
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.advertiser_confirmed,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:advertiser_confirm`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [],
                });
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const confirmed = domain
                .confirmByAdvertiser(params.confirmedAt)
                .toSnapshot();

            const updated = await tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: confirmed.status,
                    advertiserConfirmedAt: confirmed.advertiserConfirmedAt,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.advertiserId,
                    action: 'addeal_advertiser_confirmed',
                    metadata: {
                        adDealId: adDeal.id,
                        advertiserConfirmedAt: confirmed.advertiserConfirmedAt,
                    },
                },
            });

            return updated;
        });
    }
}