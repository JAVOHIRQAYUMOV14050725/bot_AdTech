import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerReason, LedgerType } from '@/modules/domain/contracts';
@Injectable()
export class LedgerService {
    constructor(private readonly prisma: PrismaService) { }

    async credit(
        walletId: string,
        amount: Prisma.Decimal,
        reason: LedgerReason,
        idempotencyKey: string,
        ref?: string,
        settlementStatus?: 'settled' | 'non_settlement',
    ) {
        const normalized = new Prisma.Decimal(amount);
        if (!settlementStatus) {
            throw new Error('Credit ledger entry requires settlement status');
        }
        return this.prisma.ledgerEntry.upsert({
            where: { idempotencyKey },
            update: {},
            create: {
                walletId,
                type: LedgerType.credit,
                amount: normalized,
                reason,
                referenceId: ref,
                idempotencyKey,
            },
        });
    }

    async debit(
        walletId: string,
        amount: Prisma.Decimal,
        reason: LedgerReason,
        idempotencyKey: string,
        ref?: string,
    ) {
        const normalized = new Prisma.Decimal(amount).negated();
        return this.prisma.ledgerEntry.upsert({
            where: { idempotencyKey },
            update: {},
            create: {
                walletId,
                type: LedgerType.debit,
                amount: normalized,
                reason,
                referenceId: ref,
                idempotencyKey,
            },
        });
    }
}
