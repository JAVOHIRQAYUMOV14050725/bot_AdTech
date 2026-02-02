import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AdDealEscrowStatus,
    Prisma,
} from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import {
    DealState,
    LedgerReason,
    LedgerType,
    TransitionActor,
    UserRole,
} from '@/modules/domain/contracts';
import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class SettleAdDealUseCase {
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

            if (adDeal.status === DealState.settled) {
                return adDeal;
            }

            const settlementEligibleStatuses: DealState[] = [
                DealState.proof_submitted,
                DealState.disputed,
            ];

            if (!settlementEligibleStatuses.includes(adDeal.status as DealState)) {
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

            if (escrow.status !== AdDealEscrowStatus.locked) {
                throw new BadRequestException(
                    `Escrow cannot be settled from status ${escrow.status}`,
                );
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

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.settled,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:settle`,
            });

            if (!transition.noop) {
                const reasons: LedgerReason[] = [LedgerReason.payout];
                if (commissionAmount.gt(0)) {
                    reasons.push(LedgerReason.commission);
                }
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons,
                });
            }

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.publisherWalletId,
                amount: payoutAmount,
                type: LedgerType.credit,
                reason: LedgerReason.payout,
                idempotencyKey: `addeal:${adDeal.id}:payout`,
                referenceId: adDeal.id,
                settlementStatus: 'settled',
                actor: params.actor ?? TransitionActor.system,
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
                    settlementStatus: 'settled',
                    actor: params.actor ?? TransitionActor.system,
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
