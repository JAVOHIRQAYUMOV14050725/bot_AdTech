import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { LedgerReason, Prisma } from '@prisma/client';
@Injectable()
export class LedgerService {
    constructor(private readonly prisma: PrismaService) { }

    async credit(
        walletId: string,
        amount: Prisma.Decimal,
        reason: LedgerReason,
        ref?: string,
    ) {
        const normalized = new Prisma.Decimal(amount);
        return this.prisma.ledgerEntry.create({
            data: {
                walletId,
                type: 'credit',
                amount: normalized,
                reason,
                referenceId: ref,
            },
        });
    }

    async debit(
        walletId: string,
        amount: Prisma.Decimal,
        reason: LedgerReason,
        ref?: string,
    ) {
        const normalized = new Prisma.Decimal(amount).negated();
        return this.prisma.ledgerEntry.create({
            data: {
                walletId,
                type: 'debit',
                amount: normalized,
                reason,
                referenceId: ref,
            },
        });
    }
}