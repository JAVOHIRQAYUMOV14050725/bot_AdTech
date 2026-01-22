import {
    BadRequestException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import Decimal from 'decimal.js';

import { Prisma, Escrow } from '@prisma/client';

@Injectable()
export class EscrowService {
    constructor(private readonly prisma: PrismaService) { }



private async lockEscrow(
        tx: Prisma.TransactionClient,
        campaignTargetId: string,
    ): Promise < Escrow | null > {
        const rows = await tx.$queryRaw<Escrow[]>`
    SELECT *
    FROM escrows
    WHERE "campaignTargetId" = ${campaignTargetId}
    FOR UPDATE
  `;

        return rows.length > 0 ? rows[0] : null;
    }
    /**
     * RELEASE ESCROW
     * Called when post is successfully published
     */
    async release(campaignTargetId: string) {
        return this.prisma.$transaction(async (tx) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            if (escrow.status !== 'held') {
                throw new ConflictException('Escrow is not in HELD state');
            }

            const total = new Decimal(escrow.amount);

            const commission = await tx.platformCommission.findUnique({
                where: { campaignTargetId },
            });

            const commissionPct = commission?.percentage ?? new Decimal(0);
            const commissionAmount = total.mul(commissionPct).div(100);
            const payoutAmount = total.sub(commissionAmount);

            // 1️⃣ PAYOUT → PUBLISHER
            await tx.wallet.update({
                where: { id: escrow.publisherWalletId },
                data: {
                    balance: { increment: payoutAmount },
                },
            });

            await tx.ledgerEntry.create({
                data: {
                    walletId: escrow.publisherWalletId,
                    type: 'credit',
                    amount: payoutAmount,
                    reason: 'payout',
                    referenceId: campaignTargetId,
                },
            });

            // 2️⃣ COMMISSION → PLATFORM
            if (commissionAmount.gt(0)) {
                const platformWallet = await tx.wallet.findFirst({
                    where: { user: { role: 'super_admin' } },
                });

                if (!platformWallet) {
                    throw new BadRequestException('Platform wallet not configured');
                }

                await tx.wallet.update({
                    where: { id: platformWallet.id },
                    data: {
                        balance: { increment: commissionAmount },
                    },
                });

                await tx.ledgerEntry.create({
                    data: {
                        walletId: platformWallet.id,
                        type: 'credit',
                        amount: commissionAmount,
                        reason: 'commission',
                        referenceId: campaignTargetId,
                    },
                });
            }

            // 3️⃣ FINALIZE ESCROW
            await tx.escrow.update({
                where: { id: escrow.id },
                data: {
                    status: 'released',
                    releasedAt: new Date(),
                },
            });

            return {
                ok: true,
                payout: payoutAmount.toFixed(2),
                commission: commissionAmount.toFixed(2),
            };
        });
    }

    /**
     * REFUND ESCROW
     * Called when post failed / rejected / cancelled
     */
    async refund(campaignTargetId: string, reason = 'post_failed') {
        return this.prisma.$transaction(async (tx) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            if (escrow.status !== 'held') {
                throw new ConflictException('Escrow is not refundable');
            }

            const amount = new Decimal(escrow.amount);

            // 1️⃣ RETURN FUNDS → ADVERTISER
            await tx.wallet.update({
                where: { id: escrow.advertiserWalletId },
                data: {
                    balance: { increment: amount },
                },
            });

            await tx.ledgerEntry.create({
                data: {
                    walletId: escrow.advertiserWalletId,
                    type: 'credit',
                    amount,
                    reason: 'refund',
                    referenceId: campaignTargetId,
                },
            });

            // 2️⃣ FINALIZE ESCROW
            await tx.escrow.update({
                where: { id: escrow.id },
                data: {
                    status: 'refunded',
                    refundedAt: new Date(),
                },
            });

            return {
                ok: true,
                refunded: amount.toFixed(2),
                reason,
            };
        });
    }
}
