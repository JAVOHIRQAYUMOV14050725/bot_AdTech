import { BadRequestException, Injectable } from '@nestjs/common';
import { ChannelStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';

@Injectable()
export class CreateAdDealUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: {
        advertiserId: string;
        publisherId: string;
        channelId?: string | null;
        amount: Prisma.Decimal | string;
        currency?: string;
        commissionPercentage?: Prisma.Decimal | string | number;
        idempotencyKey: string;
        correlationId: string;
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

        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.adDeal.findUnique({
                where: { idempotencyKey: params.idempotencyKey },
            });
            if (existing) {
                return existing;
            }

            let resolvedPublisherId = params.publisherId;
            let resolvedChannelId = params.channelId ?? null;
            if (resolvedChannelId) {
                const channel = await tx.channel.findUnique({
                    where: { id: resolvedChannelId },
                    include: { owner: true },
                });
                if (!channel) {
                    throw new BadRequestException('Channel not found');
                }
                if (channel.status !== ChannelStatus.approved) {
                    throw new BadRequestException('Channel must be approved');
                }
                resolvedPublisherId = channel.ownerId;
                if (params.publisherId && params.publisherId !== resolvedPublisherId) {
                    throw new BadRequestException('Publisher does not own channel');
                }
            }

            const id = randomUUID();
            const currency = params.currency ?? 'USD';
            const deal = AdDeal.create({
                id,
                advertiserId: params.advertiserId,
                publisherId: resolvedPublisherId,
                amount: new Prisma.Decimal(params.amount),
                currency,
            });
            const snapshot = deal.toSnapshot();

            const adDeal = await tx.adDeal.create({
                data: {
                    id: snapshot.id,
                    advertiserId: snapshot.advertiserId,
                    publisherId: resolvedPublisherId,
                    channelId: resolvedChannelId,
                    amount: new Prisma.Decimal(snapshot.amount),
                    currency: snapshot.currency,
                    status: snapshot.status,
                    createdAt: snapshot.createdAt,
                    commissionPercentage,
                    idempotencyKey: params.idempotencyKey,
                    correlationId: params.correlationId,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: adDeal.advertiserId,
                    action: 'addeal_created',
                    metadata: {
                        adDealId: adDeal.id,
                        publisherId: adDeal.publisherId,
                        channelId: resolvedChannelId,
                        amount: adDeal.amount.toFixed(2),
                        currency: adDeal.currency,
                        commissionPercentage: commissionPercentage?.toFixed(2) ?? null,
                        correlationId: params.correlationId,
                    },
                },
            });

            return adDeal;
        });
    }
}
