import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdDealEscrowStatus, LedgerReason, LedgerType, Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
import { toAdDealSnapshot } from './addeal.mapper';
import { TransitionActor } from '@/modules/lifecycle/lifecycle';

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

            if (adDeal.status === AdDealStatus.refunded) {
                return adDeal;
            }

            if (
                ![
                    AdDealStatus.escrow_locked,
                    AdDealStatus.proof_submitted,
                    AdDealStatus.disputed,
                ].includes(adDeal.status as AdDealStatus)
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

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.advertiserWalletId,
                amount: escrow.amount,
                type: LedgerType.credit,
                reason: LedgerReason.refund,
                idempotencyKey: `addeal:${adDeal.id}:refund`,
                referenceId: adDeal.id,
                actor: params.actor ?? 'system',
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