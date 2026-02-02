import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';
import { AdDeal } from '@/modules/domain/addeal/addeal.aggregate';
import { AdDealStatus } from '@/modules/domain/addeal/addeal.types';
import { toAdDealSnapshot } from './addeal.mapper';

@Injectable()
export class AcceptDealUseCase {
    constructor(private readonly prisma: PrismaService) { }

    async execute(params: { adDealId: string; acceptedAt?: Date }) {
        return this.prisma.$transaction(async (tx) => {
            const adDeal = await tx.adDeal.findUnique({
                where: { id: params.adDealId },
            });

            if (!adDeal) {
                throw new NotFoundException('AdDeal not found');
            }

            if (adDeal.status === AdDealStatus.accepted) {
                return adDeal;
            }

            if (adDeal.status !== AdDealStatus.escrow_locked) {
                throw new BadRequestException(
                    `AdDeal cannot be accepted from status ${adDeal.status}`,
                );
            }

            const domain = AdDeal.rehydrate(toAdDealSnapshot(adDeal));
            const accepted = domain.accept(params.acceptedAt).toSnapshot();

            return tx.adDeal.update({
                where: { id: adDeal.id },
                data: {
                    status: accepted.status,
                    acceptedAt: accepted.acceptedAt,
                },
            });
        });
    }
}