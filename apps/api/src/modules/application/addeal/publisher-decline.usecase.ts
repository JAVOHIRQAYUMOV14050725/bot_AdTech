import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealEscrowStatus } from '@prisma/client';
import { DealState, LedgerReason, LedgerType, TransitionActor } from '@/modules/domain/contracts';
import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class PublisherDeclineUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) { }

    async execute(params: {
        adDealId: string;
        declinedAt?: Date;
        actor?: TransitionActor;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.publisher_declined) {
                return adDeal;
            }

            if (adDeal.status !== DealState.publisher_requested) {
                throw new BadRequestException(
                    `AdDeal cannot be declined from status ${adDeal.status}`,
                );
            }

            const escrow = await tx.adDealEscrow.findUnique({
                where: { adDealId: adDeal.id },
            });
            if (!escrow) {
                throw new BadRequestException('AdDeal escrow not found');
            }
            if (escrow.status !== AdDealEscrowStatus.locked) {
                throw new BadRequestException(
                    `Escrow cannot be refunded from status ${escrow.status}`,
                );
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.publisher_declined,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:publisher_decline`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [LedgerReason.refund],
                });
            }

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.advertiserWalletId,
                amount: adDeal.amount,
                type: LedgerType.credit,
                reason: LedgerReason.refund,
                idempotencyKey: `addeal:${adDeal.id}:publisher_decline_refund`,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:publisher_decline`,
                referenceId: adDeal.id,
            });

            await tx.adDealEscrow.update({
                where: { adDealId: adDeal.id },
                data: { status: AdDealEscrowStatus.refunded },
            });

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const declined = domain
                .declineByPublisher(params.declinedAt)
                .toSnapshot();

            const updated = await tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: declined.status,
                    publisherDeclinedAt: declined.publisherDeclinedAt,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.publisherId,
                    action: 'addeal_publisher_declined',
                    metadata: {
                        adDealId: adDeal.id,
                        publisherDeclinedAt: declined.publisherDeclinedAt,
                    },
                },
            });

            return updated;
        });
    }
}
