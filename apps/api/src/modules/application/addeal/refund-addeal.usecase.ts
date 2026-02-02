import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdDealEscrowStatus, Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import {
    DealState,
    LedgerReason,
    LedgerType,
    TransitionActor,
} from '@/modules/domain/contracts';
import { toAdDealSnapshot } from './addeal.mapper';
import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';

@Injectable()
export class RefundAdDealUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) { }

    async execute(params: {
        adDealId: string;
        actor?: TransitionActor;
        transaction?: Prisma.TransactionClient;
    }) {
        const execute = async (tx: Prisma.TransactionClient) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.refunded) {
                return adDeal;
            }

            if (
                ![
                    DealState.escrow_locked,
                    DealState.proof_submitted,
                    DealState.disputed,
                ].includes(adDeal.status as DealState)
            ) {
                throw new BadRequestException(
                    `AdDeal cannot be refunded from status ${adDeal.status}`,
                );
            }

            const escrow = await tx.adDealEscrow.findUnique({
                where: { adDealId: adDeal.id },
            });

            if (!escrow) {
                throw new BadRequestException('Escrow not found for deal');
            }

            if (escrow.status !== AdDealEscrowStatus.locked) {
                throw new BadRequestException(
                    `Escrow cannot be refunded from status ${escrow.status}`,
                );
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.refunded,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:refund`,
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
                amount: escrow.amount,
                type: LedgerType.credit,
                reason: LedgerReason.refund,
                idempotencyKey: `addeal:${adDeal.id}:refund`,
                referenceId: adDeal.id,
                settlementStatus: 'settled',
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:refund`,
            });

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const refunded = domain.refund().toSnapshot();

            await tx.adDealEscrow.update({
                where: { adDealId: adDeal.id },
                data: {
                    status: AdDealEscrowStatus.refunded,
                    refundedAt: new Date(),
                },
            });

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: refunded.status,
                    refundedAt: refunded.refundedAt,
                },
            });
        };

        if (params.transaction) {
            return execute(params.transaction);
        }

        return this.prisma.$transaction(execute);
    }
}