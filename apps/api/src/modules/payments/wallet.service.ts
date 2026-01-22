import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Injectable()
export class WalletService {
    constructor(private readonly prisma: PrismaService) { }

    async increment(walletId: string, amount: Prisma.Decimal) {
        return this.prisma.wallet.update({
            where: { id: walletId },
            data: {
                balance: { increment: amount },
            },
        });
    }

    async decrement(walletId: string, amount: Prisma.Decimal) {
        const result = await this.prisma.wallet.updateMany({
            where: {
                id: walletId,
                balance: { gte: amount },
            },
            data: {
                balance: { decrement: amount },
            },
        });

        if (result.count === 0) {
            throw new BadRequestException('Insufficient balance');
        }

        return result;
    }
}
