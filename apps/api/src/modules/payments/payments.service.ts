import { PrismaService } from '@/prisma/prisma.service';
import { Escrow, Prisma } from '@prisma/client';
import { Injectable } from "@nestjs/common";
import { WalletService } from './wallet.service';
import { LedgerService } from './ledger.service';

@Injectable()
export class PaymentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly wallet: WalletService,
        private readonly ledger: LedgerService,
    ) { }

    /**
     * 💰 USER DEPOSIT
     */
    async deposit(userId: string, amount: Prisma.Decimal) {
        return this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUniqueOrThrow({
                where: { userId },
            });

            await tx.ledgerEntry.create({
                data: {
                    walletId: wallet.id,
                    type: 'credit',
                    amount,
                    reason: 'deposit',
                },
            });

            await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: { increment: amount },
                },
            });

            return { ok: true };
        });
    }
}
