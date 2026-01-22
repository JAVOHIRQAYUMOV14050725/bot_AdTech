
import { PrismaService } from '@/prisma/prisma.service';
import {
    CampaignTargetStatus,
    EscrowStatus,
    KillSwitchKey,
    LedgerReason,
    LedgerType,
    Prisma,
} from '@prisma/client';
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly killSwitchService: KillSwitchService,
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

    async recordWalletMovement(params: {
        tx: Prisma.TransactionClient;
        walletId: string;
        amount: Prisma.Decimal;
        type: LedgerType;
        reason: LedgerReason;
        referenceId?: string;
        idempotencyKey?: string;
        campaignId?: string;
        campaignTargetId?: string;
        escrowId?: string;
        actor?: string;
        correlationId?: string;
    }) {
        const {
            tx,
            walletId,
            amount,
            type,
            reason,
            referenceId,
            idempotencyKey,
            campaignId,
            campaignTargetId,
            escrowId,
            actor,
            correlationId,
        } = params;

        const normalizedAmount = this.normalizeDecimal(amount);

        if (idempotencyKey) {
            const existing = await tx.ledgerEntry.findUnique({
                where: { idempotencyKey },
            });
            if (existing) {
                return existing;
            }
        }

        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Amount must be positive');
        }

        let ledgerEntry;
        try {
            ledgerEntry = await tx.ledgerEntry.create({
                data: {
                    walletId,
                    type,
                    amount:
                        type === LedgerType.debit
                            ? normalizedAmount.negated()
                            : normalizedAmount,
                    reason,
                    referenceId,
                    idempotencyKey,
                },
            });
        } catch (err) {
            if (idempotencyKey) {
                const existing = await tx.ledgerEntry.findUnique({
                    where: { idempotencyKey },
                });
                if (existing) {
                    return existing;
                }
            }
            throw err;
        }

        if (type === LedgerType.debit) {
            const debitResult = await tx.wallet.updateMany({
                where: {
                    id: walletId,
                    balance: { gte: normalizedAmount },
                },
                data: {
                    balance: { decrement: normalizedAmount },
                },
            });

            if (debitResult.count === 0) {
                throw new BadRequestException('Insufficient balance');
            }
        } else {
            await tx.wallet.update({
                where: { id: walletId },
                data: {
                    balance: { increment: normalizedAmount },
                },
            });
        }

        await tx.financialAuditEvent.create({
            data: {
                walletId,
                ledgerEntryId: ledgerEntry.id,
                campaignId,
                campaignTargetId,
                escrowId,
                type,
                amount: ledgerEntry.amount,
                reason,
                actor,
                correlationId,
            },
        });

        await this.assertLedgerMatchesWallet(tx, walletId);

        return ledgerEntry;
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

            await this.recordWalletMovement({
                tx,
                walletId: wallet.id,
                amount: normalizedAmount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                actor: 'system',
                correlationId: `deposit:${userId}`,
            });

            return { ok: true };
        });
    }

    /**
     * =========================================================
     * 🔒 ESCROW HOLD (CAMPAIGN TARGET)
     * =========================================================
     */
    async holdEscrow(
        campaignTargetId: string,
        options?: { transaction?: Prisma.TransactionClient; actor?: string; correlationId?: string },
    ) {
        await this.killSwitchService.assertEnabled({
            key: KillSwitchKey.new_escrows,
            reason: 'Escrow holds paused',
            correlationId: options?.correlationId ?? campaignTargetId,
        });

        const execute = async (tx: Prisma.TransactionClient) => {
            const existingEscrow = await tx.escrow.findUnique({
                where: { campaignTargetId },
            });

            if (existingEscrow) {
                if (existingEscrow.status === EscrowStatus.held) {
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

            if (target.status !== CampaignTargetStatus.approved) {
                this.logger.error(
                    `[FSM] Escrow hold blocked: campaignTarget=${campaignTargetId} is ${target.status}`,
                );
                throw new ConflictException(
                    `Escrow hold requires campaign target ${campaignTargetId} to be approved`,
                );
            }

            const advertiserWallet = target.campaign.advertiser.wallet;
            const publisherWallet = target.channel.owner.wallet;

            if (!advertiserWallet || !publisherWallet) {
                throw new BadRequestException('Wallets not configured');
            }

            const amount = this.normalizeDecimal(target.price);

            await this.recordWalletMovement({
                tx,
                walletId: advertiserWallet.id,
                amount,
                type: LedgerType.debit,
                reason: LedgerReason.escrow_hold,
                referenceId: campaignTargetId,
                idempotencyKey: `escrow_hold:${campaignTargetId}`,
                campaignId: target.campaignId,
                campaignTargetId,
                actor: options?.actor ?? 'system',
                correlationId: options?.correlationId ?? campaignTargetId,
            });

            await tx.escrow.create({
                data: {
                    campaignTargetId,
                    advertiserWalletId: advertiserWallet.id,
                    publisherWalletId: publisherWallet.id,
                    amount,
                    status: EscrowStatus.held,
                },
            });

            return { ok: true };
        };

        if (options?.transaction) {
            return execute(options.transaction);
        }

        return this.prisma.$transaction(execute);
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
        const total = this.normalizeDecimal(totalAmount).toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
        );
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

        commissionAmount = commissionAmount.toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
        );

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