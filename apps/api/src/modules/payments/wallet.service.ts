import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
@Injectable()
export class WalletService {
    constructor(private readonly prisma: PrismaService) { }

    async increment(walletId: string, amount: Decimal) {
        return this.prisma.wallet.update({
            where: { id: walletId },
            data: {
                balance: { increment: amount },
            },
        });
    }

    async decrement(walletId: string, amount: Decimal) {
        return this.prisma.wallet.update({
            where: { id: walletId },
            data: {
                balance: { decrement: amount },
            },
        });
    }
}
