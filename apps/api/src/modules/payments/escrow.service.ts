import {
    BadRequestException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

import { Prisma, Escrow } from '@prisma/client';
import { PaymentsService } from './payments.service';

@Injectable()
export class EscrowService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
    ) { }

    private async lockEscrow(
        tx: Prisma.TransactionClient,
        campaignTargetId: string,
    ): Promise<Escrow | null> {
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
    async release(
        campaignTargetId: string,
        transaction?: Prisma.TransactionClient,
    ) {
        const execute = async (tx: Prisma.TransactionClient) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            if (escrow.status === 'released') {
                return {
                    ok: true,
                    alreadyReleased: true,
                };
            }

            if (escrow.status !== 'held') {
                throw new ConflictException('Escrow is not in HELD state');
            }

            const total = new Prisma.Decimal(escrow.amount);

            const commission = await tx.platformCommission.findUnique({
                where: { campaignTargetId },
            });

            const { commissionAmount, payoutAmount } =
                this.paymentsService.calculateCommissionSplit(total, commission);

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

            let platformWalletId: string | null = null;
            // 2️⃣ COMMISSION → PLATFORM
            if (commissionAmount.gt(0)) {
                const platformWallet = await tx.wallet.findFirst({
                    where: { user: { role: 'super_admin' } },
                });

                if (!platformWallet) {
                    throw new BadRequestException('Platform wallet not configured');
                }

                platformWalletId = platformWallet.id;
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

            await this.paymentsService.ensureWalletInvariant(
                tx,
                escrow.publisherWalletId,
            );

            if (platformWalletId) {
                await this.paymentsService.ensureWalletInvariant(
                    tx,
                    platformWalletId,
                );
            }

            return {
                ok: true,
                payout: payoutAmount.toFixed(2),
                commission: commissionAmount.toFixed(2),
            };
        };

        if (transaction) {
            return execute(transaction);
        }

        return this.prisma.$transaction(execute);
    }

    /**
     * REFUND ESCROW
     * Called when post failed / rejected / cancelled
     */
    async refund(
        campaignTargetId: string,
        reason = 'post_failed',
        transaction?: Prisma.TransactionClient,
    ) {
        const execute = async (tx: Prisma.TransactionClient) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            if (escrow.status === 'refunded') {
                return {
                    ok: true,
                    alreadyRefunded: true,
                };
            }

            if (escrow.status !== 'held') {
                throw new ConflictException('Escrow is not refundable');
            }

            const amount = new Prisma.Decimal(escrow.amount);

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

            await this.paymentsService.ensureWalletInvariant(
                tx,
                escrow.advertiserWalletId,
            );

            return {
                ok: true,
                refunded: amount.toFixed(2),
                reason,
            };
        };

        if (transaction) {
            return execute(transaction);
        }

        return this.prisma.$transaction(execute);
    }
}