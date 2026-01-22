import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
} from '@nestjs/common';

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
    ) { }

    private normalizeDecimal(value: Prisma.Decimal) {
        return new Prisma.Decimal(value);
    }

    private async assertLedgerMatchesWallet(
        tx: Prisma.TransactionClient,
        walletId: string,
    ) {
        const wallet = await tx.wallet.findUnique({
            where: { id: walletId },
            select: { balance: true },
        });

        if (!wallet) {
            throw new BadRequestException('Wallet not found');
        }

        const agg = await tx.ledgerEntry.aggregate({
            where: { walletId },
            _sum: { amount: true },
        });

        const ledgerSum = new Prisma.Decimal(agg._sum.amount ?? 0);
        const balance = new Prisma.Decimal(wallet.balance ?? 0);

        if (!ledgerSum.equals(balance)) {
            throw new ConflictException(
                `Ledger invariant violated for wallet=${walletId}`,
            );
        }
    }

    /**
     * 💰 USER DEPOSIT
     */
    async deposit(userId: string, amount: Prisma.Decimal) {
        const normalizedAmount = this.normalizeDecimal(amount);
        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Deposit amount must be positive');
        }

        return this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUniqueOrThrow({
                where: { userId },
            });

            await tx.ledgerEntry.create({
                data: {
                    walletId: wallet.id,
                    type: 'credit',
                    amount: normalizedAmount,
                    reason: 'deposit',
                },
            });

            await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: { increment: normalizedAmount },
                },
            });

            await this.assertLedgerMatchesWallet(tx, wallet.id);

            return { ok: true };
        });
    }

    /**
     * =========================================================
     * 🔒 ESCROW HOLD (CAMPAIGN TARGET)
     * =========================================================
     */
    async holdEscrow(campaignTargetId: string) {
        return this.prisma.$transaction(async (tx) => {
            const existingEscrow = await tx.escrow.findUnique({
                where: { campaignTargetId },
            });

            if (existingEscrow) {
                if (existingEscrow.status === 'held') {
                    return { ok: true, alreadyHeld: true };
                }

                throw new ConflictException(
                    `Escrow already ${existingEscrow.status}`,
                );
            }

            const target = await tx.campaignTarget.findUnique({
                where: { id: campaignTargetId },
                include: {
                    campaign: {
                        include: {
                            advertiser: {
                                include: { wallet: true },
                            },
                        },
                    },
                    channel: {
                        include: {
                            owner: {
                                include: { wallet: true },
                            },
                        },
                    },
                    commission: true,
                },
            });

            if (!target) {
                throw new BadRequestException('Campaign target not found');
            }

            if (target.status !== 'pending') {
                this.logger.error(
                    `[FSM] Escrow hold blocked: campaignTarget=${campaignTargetId} is ${target.status}`,
                );
                throw new ConflictException(
                    `Escrow hold requires campaign target ${campaignTargetId} to be pending`,
                );
            }

            const advertiserWallet = target.campaign.advertiser.wallet;
            const publisherWallet = target.channel.owner.wallet;

            if (!advertiserWallet || !publisherWallet) {
                throw new BadRequestException('Wallets not configured');
            }

            const amount = this.normalizeDecimal(target.price);

            const debitResult = await tx.wallet.updateMany({
                where: {
                    id: advertiserWallet.id,
                    balance: { gte: amount },
                },
                data: {
                    balance: { decrement: amount },
                },
            });

            if (debitResult.count === 0) {
                throw new BadRequestException('Insufficient balance');
            }

            await tx.ledgerEntry.create({
                data: {
                    walletId: advertiserWallet.id,
                    type: 'debit',
                    amount: amount.negated(),
                    reason: 'escrow_hold',
                    referenceId: campaignTargetId,
                },
            });

            await tx.escrow.create({
                data: {
                    campaignTargetId,
                    advertiserWalletId: advertiserWallet.id,
                    publisherWalletId: publisherWallet.id,
                    amount,
                    status: 'held',
                },
            });

            await this.assertLedgerMatchesWallet(tx, advertiserWallet.id);

            return { ok: true };
        });
    }

    /**
     * =========================================================
     * 💸 COMMISSION SPLIT (PURE CALC)
     * =========================================================
     */
    calculateCommissionSplit(
        totalAmount: Prisma.Decimal,
        commission:
            | {
                amount: Prisma.Decimal;
                percentage: Prisma.Decimal;
            }
            | null,
    ) {
        const total = this.normalizeDecimal(totalAmount);
        let commissionAmount = new Prisma.Decimal(0);

        if (commission?.amount) {
            const amount = this.normalizeDecimal(commission.amount);
            if (amount.gt(0)) {
                commissionAmount = amount;
            } else if (commission?.percentage) {
                const percentage = this.normalizeDecimal(commission.percentage);
                if (percentage.gt(0)) {
                    commissionAmount = total.mul(percentage).div(100);
                }
            }
        } else if (commission?.percentage) {
            const percentage = this.normalizeDecimal(commission.percentage);
            if (percentage.gt(0)) {
                commissionAmount = total.mul(percentage).div(100);
            }
        }

        if (commissionAmount.gt(total)) {
            throw new BadRequestException(
                'Commission exceeds escrow amount',
            );
        }

        const payoutAmount = total.sub(commissionAmount);

        return {
            totalAmount: total,
            commissionAmount,
            payoutAmount,
        };
    }

    async ensureWalletInvariant(
        tx: Prisma.TransactionClient,
        walletId: string,
    ) {
        await this.assertLedgerMatchesWallet(tx, walletId);
    }
}
