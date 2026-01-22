import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { LedgerReason } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
@Injectable()
export class LedgerService {
    constructor(private readonly prisma: PrismaService) { }

    async credit(walletId: string, amount: Decimal, reason: LedgerReason, ref?: string) {
        return this.prisma.ledgerEntry.create({
            data: {
                walletId,
                type: 'credit',
                amount,
                reason,
                referenceId: ref,
            },
        });
    }

    async debit(walletId: string, amount: Decimal, reason: LedgerReason, ref?: string) {
        return this.prisma.ledgerEntry.create({
            data: {
                walletId,
                type: 'debit',
                amount,
                reason,
                referenceId: ref,
            },
        });
    }
}
