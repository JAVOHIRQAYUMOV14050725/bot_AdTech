import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class BalanceService {
    constructor(private readonly prisma: PrismaService) { }

    async getWalletBalance(walletId: string): Promise<Decimal> {
        const agg = await this.prisma.ledgerEntry.aggregate({
            where: { walletId },
            _sum: { amount: true },
        });

        return new Decimal(agg._sum.amount ?? 0);
    }
}
