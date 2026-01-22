import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { LedgerReason, LedgerType, Prisma } from '@prisma/client';
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
                type: LedgerType.credit,
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
                type: LedgerType.debit,
                amount: normalized,
                reason,
                referenceId: ref,
            },
        });
    }
}