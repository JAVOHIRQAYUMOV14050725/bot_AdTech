import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';

@Injectable()
export class CreateAdDealUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        advertiserId: string;
        publisherId: string;
        amount: Prisma.Decimal | string;
        currency?: string;
        commissionPercentage?: Prisma.Decimal | string | number;
    }) {
        const commissionPercentage =
            params.commissionPercentage === undefined
                ? null
                : new Prisma.Decimal(params.commissionPercentage).toDecimalPlaces(
                    2,
                    Prisma.Decimal.ROUND_HALF_UP,
                );

        if (commissionPercentage && commissionPercentage.lt(0)) {
            throw new BadRequestException(
                'Commission percentage cannot be negative',
            );
        }

        if (commissionPercentage && commissionPercentage.gt(100)) {
            throw new BadRequestException(
                'Commission percentage cannot exceed 100%',
            );
        }

        const id = randomUUID();
        const currency = params.currency ?? 'USD';
        const deal = AdDeal.create({
            id,
            advertiserId: params.advertiserId,
            publisherId: params.publisherId,
            amount: new Prisma.Decimal(params.amount),
            currency,
        });

        const snapshot = deal.toSnapshot();

        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.create({
                data: {
                    id: snapshot.id,
                    advertiserId: snapshot.advertiserId,
                    publisherId: snapshot.publisherId,
                    amount: new Prisma.Decimal(snapshot.amount),
                    currency: snapshot.currency,
                    status: snapshot.status,
                    createdAt: snapshot.createdAt,
                    commissionPercentage,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.advertiserId,
                    action: 'addeal_created',
                    metadata: {
                        adDealId: adDeal.id,
                        publisherId: adDeal.publisherId,
                        amount: adDeal.amount.toFixed(2),
                        currency: adDeal.currency,
                        commissionPercentage: commissionPercentage?.toFixed(2) ?? null,
                    },
                },
            });

            return adDeal;
        });
    }
}
