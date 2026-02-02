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
export class FundAdDealUseCase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) { }

    async execute(params: {
        adDealId: string;
        provider: string;
        providerReference: string;
        amount: Prisma.Decimal | string;
        verified: boolean;
        receivedAt?: Date;
        actor?: TransitionActor;
    }) {
        if (!params.verified) {
            throw new BadRequestException(
                'Provider callback must be verified before funding',
            );
        }

        const receivedAt = params.receivedAt ?? new Date();
        const provider =
            params.provider === 'telegram_sandbox'
                ? 'internal_custody'
                : params.provider;
        const fundingAmount = new Prisma.Decimal(params.amount).toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
        );

        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.amount.toFixed(2) !== fundingAmount.toFixed(2)) {
                throw new BadRequestException('Funding amount mismatch');
            }

            const existingFundingEvent = await tx.adDealFundingEvent.findUnique({
                where: { providerReference: params.providerReference },
            });

            if (existingFundingEvent && existingFundingEvent.adDealId !== adDeal.id) {
                throw new BadRequestException(
                    'Funding reference already bound to another deal',
                );
            }

            if (!existingFundingEvent && adDeal.status !== DealState.created) {
                throw new BadRequestException(
                    `AdDeal funding rejected from status ${adDeal.status}`,
                );
            }

            await tx.adDealFundingEvent.upsert({
                where: { providerReference: params.providerReference },
                update: {},
                create: {
                    adDealId: adDeal.id,
                    provider,
                    providerReference: params.providerReference,
                    amount: fundingAmount,
                    receivedAt,
                },
            });

            let wallet = await tx.wallet.findUnique({
                where: { userId: adDeal.advertiserId },
            });

            if (!wallet) {
                wallet = await tx.wallet.create({
                    data: {
                        userId: adDeal.advertiserId,
                        balance: new Prisma.Decimal(0),
                    },
                });
            }

            const transition = assertAdDealTransition({
                adDealId: adDeal.id,
                from: adDeal.status as DealState,
                to: DealState.funded,
                actor: params.actor ?? TransitionActor.payment_provider,
                correlationId: `addeal:${adDeal.id}:fund`,
            });

            if (!transition.noop) {
                assertAdDealMoneyMovement({
                    adDealId: adDeal.id,
                    rule: transition.rule,
                    reasons: [LedgerReason.deposit],
                });
            }

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: wallet.id,
                amount: fundingAmount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                idempotencyKey: `addeal:fund:${params.providerReference}`,
                settlementStatus: 'non_settlement',
                actor: params.actor ?? TransitionActor.payment_provider,
                correlationId: `addeal:${adDeal.id}:fund`,
            });

            if (adDeal.status !== DealState.created) {
                return adDeal;
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const funded = domain.fund(receivedAt).toSnapshot();

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: funded.status,
                    fundedAt: funded.fundedAt,
                },
            });
        });
    }
}
