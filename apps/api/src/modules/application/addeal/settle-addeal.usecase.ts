import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AdDealEscrowStatus,
    LedgerReason,
    LedgerType,
    Prisma,
    UserRole,
} from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class SettleAdDealUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) {}

    async execute(params: {
        adDealId: string;
        actor?: string;
        transaction?: Prisma.TransactionClient;
    }) {
        const execute = async (tx: Prisma.TransactionClient) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === AdDealStatus.settled) {
                return adDeal;
            }

            if (
                ![AdDealStatus.proof_submitted, AdDealStatus.disputed].includes(
                    adDeal.status as AdDealStatus,
                )
            ) {
                throw new BadRequestException(
                    `AdDeal cannot be settled from status ${adDeal.status}`,
                );
            }

            const escrow = await tx.adDealEscrow.findUnique({
                where: { adDealId: adDeal.id },
            });

            if (!escrow) {
                throw new BadRequestException('Escrow not found for deal');
            }

            const commission = adDeal.commissionPercentage
                ? {
                      amount: new Prisma.Decimal(0),
                      percentage: adDeal.commissionPercentage,
                  }
                : null;

            const { totalAmount, commissionAmount, payoutAmount } =
                this.paymentsService.calculateCommissionSplit(
                    escrow.amount,
                    commission,
                );

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.publisherWalletId,
                amount: payoutAmount,
                type: LedgerType.credit,
                reason: LedgerReason.payout,
                idempotencyKey: `addeal:${adDeal.id}:payout`,
                referenceId: adDeal.id,
                actor: params.actor ?? 'system',
                correlationId: `addeal:${adDeal.id}:settle`,
            });

            if (commissionAmount.gt(0)) {
                const platformWallet = await tx.wallet.findFirst({
                    where: { user: { role: UserRole.super_admin } },
                });

                if (!platformWallet) {
                    throw new BadRequestException(
                        'Platform wallet not configured',
                    );
                }

                await this.paymentsService.recordWalletMovement({
                    tx,
                    walletId: platformWallet.id,
                    amount: commissionAmount,
                    type: LedgerType.credit,
                    reason: LedgerReason.commission,
                    idempotencyKey: `addeal:${adDeal.id}:commission`,
                    referenceId: adDeal.id,
                    actor: params.actor ?? 'system',
                    correlationId: `addeal:${adDeal.id}:settle`,
                });
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const settled = domain.settle().toSnapshot();

            await tx.adDealEscrow.update({
                where: { adDealId: adDeal.id },
                data: {
                    status: AdDealEscrowStatus.settled,
                    settledAt: new Date(),
                },
            });

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: settled.status,
                    settledAt: settled.settledAt,
                    commissionAmount: commissionAmount,
                },
            });
        };

        if (params.transaction) {
            return execute(params.transaction);
        }

        return this.prisma.$transaction(execute);
    }
}
