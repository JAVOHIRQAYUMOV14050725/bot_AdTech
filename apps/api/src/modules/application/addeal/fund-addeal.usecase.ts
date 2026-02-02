import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerReason, LedgerType, Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
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
    }) {
        if (!params.verified) {
            throw new BadRequestException(
                'Provider callback must be verified before funding',
            );
        }

        const receivedAt = params.receivedAt ?? new Date();
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

            const fundingEvent = await tx.adDealFundingEvent.upsert({
                where: { providerReference: params.providerReference },
                update: {},
                create: {
                    adDealId: adDeal.id,
                    provider: params.provider,
                    providerReference: params.providerReference,
                    amount: fundingAmount,
                    receivedAt,
                },
            });

            if (fundingEvent.adDealId !== adDeal.id) {
                throw new BadRequestException(
                    'Funding reference already bound to another deal',
                );
            }

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

            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: wallet.id,
                amount: fundingAmount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                idempotencyKey: `addeal:fund:${params.providerReference}`,
                actor: 'payment_provider',
                correlationId: `addeal:${adDeal.id}:fund`,
            });

            if (adDeal.status !== AdDealStatus.created) {
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