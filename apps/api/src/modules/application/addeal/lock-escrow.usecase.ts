import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import {
    DealState,
    LedgerReason,
    LedgerType,
    TransitionActor,
} from '@/modules/domain/contracts';
import {
    assertAdDealMoneyMovement,
    assertAdDealTransition,
} from '@/modules/domain/addeal/addeal.lifecycle';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class LockEscrowUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) { }

    async execute(params: {
        adDealId: string;
        actor?: TransitionActor;
    }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === DealState.escrow_locked) {
                return adDeal;
            }

            if (adDeal.status !== DealState.funded) {
                throw new BadRequestException(
                    `AdDeal cannot lock escrow from status ${adDeal.status}`,
                );
            }

            let advertiserWallet = await tx.wallet.findUnique({
                where: { userId: adDeal.advertiserId },
            });

            if (!advertiserWallet) {
                advertiserWallet = await tx.wallet.create({
                    data: {
                        userId: adDeal.advertiserId,
                        balance: new Prisma.Decimal(0),
                    },
                });
            }

            let publisherWallet = await tx.wallet.findUnique({
                where: { userId: adDeal.publisherId },
            });

            if (!publisherWallet) {
                publisherWallet = await tx.wallet.create({
                    data: {
                        userId: adDeal.publisherId,
                        balance: new Prisma.Decimal(0),
                    },
                });
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.escrow_locked,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:escrow_lock`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [LedgerReason.escrow_hold],
                });
            }

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: advertiserWallet.id,
                amount: adDeal.amount,
                type: LedgerType.debit,
                reason: LedgerReason.escrow_hold,
                idempotencyKey: `addeal:${adDeal.id}:escrow_lock`,
                actor: params.actor ?? TransitionActor.system,
                correlationId: `addeal:${adDeal.id}:escrow_lock`,
                referenceId: adDeal.id,
            });

            await tx.adDealEscrow.upsert({
                where: { adDealId: adDeal.id },
                update: {},
                create: {
                    adDealId: adDeal.id,
                    advertiserWalletId: advertiserWallet.id,
                    publisherWalletId: publisherWallet.id,
                    amount: adDeal.amount,
                },
            });

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const locked = domain.lockEscrow().toSnapshot();

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: locked.status,
                    lockedAt: locked.lockedAt,
                },
            });
        });
    }
}