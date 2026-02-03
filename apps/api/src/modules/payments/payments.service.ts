
import { PrismaService } from '@/prisma/prisma.service';
import {
    CampaignTargetStatus,
    CampaignStatus,
    EscrowStatus,
    KillSwitchKey,
    Prisma,
} from '@prisma/client';
import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    LoggerService,
} from '@nestjs/common';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import {
    LedgerReason,
    LedgerType,
    TransitionActor,
} from '@/modules/domain/contracts';


@Injectable()
export class PaymentsService {


    constructor(
        private readonly prisma: PrismaService,
        private readonly killSwitchService: KillSwitchService,
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService
    ) { }

    private static readonly MAX_ESCROW_AMOUNT = new Prisma.Decimal('999999999999.99');

    private normalizeDecimal(value: Prisma.Decimal) {
        return new Prisma.Decimal(value);
    }

    private assertEscrowAmountSafe(amount: Prisma.Decimal, campaignTargetId: string) {
        const normalized = this.normalizeDecimal(amount);
        const decimals = normalized.decimalPlaces();

        if (decimals > 2 || normalized.abs().gt(PaymentsService.MAX_ESCROW_AMOUNT)) {
            this.logger.error({
                event: 'escrow_amount_invalid_precision',
                alert: true,
                entityType: 'campaign_target',
                entityId: campaignTargetId,
                data: {
                    amount: normalized.toFixed(2),
                    decimals,
                    max: PaymentsService.MAX_ESCROW_AMOUNT.toFixed(2),
                },
            },
                'PaymentsService',
            );
            throw new ConflictException('Escrow amount precision invalid');
        }
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
            this.logger.error({
                event: 'ledger_invariant_failed',
                alert: true,
                entityType: 'wallet',
                entityId: walletId,
                data: {
                    walletBalance: balance.toFixed(2),
                    ledgerSum: ledgerSum.toFixed(2),
                },
            },
                undefined,
                'PaymentsService',
            );

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
        settlementStatus?: 'settled' | 'non_settlement';
        referenceId?: string;
        idempotencyKey: string;
        campaignId?: string;
        campaignTargetId?: string;
        escrowId?: string;
        actor?: TransitionActor;
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

        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Amount must be positive');
        }

        if (type === LedgerType.credit && !params.settlementStatus) {
            throw new BadRequestException(
                'Credit ledger entry requires explicit settlement status',
            );
        }

        /* ─────────────────────────────────────────────
           1️⃣ IDEMPOTENCY FAST-PATH
        ───────────────────────────────────────────── */
        const existing = await tx.ledgerEntry.findUnique({
            where: { idempotencyKey },
        });

        if (existing) {
            return existing;
        }

        /* ─────────────────────────────────────────────
           2️⃣ WALLET ROW LOCK (SERIALIZABLE BEHAVIOR)
        ───────────────────────────────────────────── */
        const wallet = await tx.wallet.findUnique({
            where: { id: walletId },
            select: { id: true, balance: true },
        });

        if (!wallet) {
            throw new BadRequestException('Wallet not found');
        }

        if (type === LedgerType.debit && wallet.balance.lt(normalizedAmount)) {
            throw new BadRequestException('Insufficient balance');
        }

        /* ─────────────────────────────────────────────
           3️⃣ APPLY WALLET BALANCE (SOURCE OF TRUTH)
        ───────────────────────────────────────────── */
        const updatedWallet = await tx.wallet.update({
            where: { id: walletId },
            data:
                type === LedgerType.debit
                    ? { balance: { decrement: normalizedAmount } }
                    : { balance: { increment: normalizedAmount } },
        });

        /* ─────────────────────────────────────────────
           4️⃣ WRITE LEDGER ENTRY
        ───────────────────────────────────────────── */
        const ledgerEntry = await tx.ledgerEntry.create({
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

        /* ─────────────────────────────────────────────
           5️⃣ FINANCIAL AUDIT EVENT (STRICT IDEMPOTENT)
        ───────────────────────────────────────────── */
        await tx.financialAuditEvent.create({
            data: {
                walletId,
                ledgerEntryId: ledgerEntry.id,
                idempotencyKey: `audit:${idempotencyKey}`,
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

        /* ─────────────────────────────────────────────
           6️⃣ INVARIANT ASSERT (OPTIONAL / FEATURE FLAG)
        ───────────────────────────────────────────── */
        const enableInvariant =
            this.configService.get<boolean>(
                'ENABLE_LEDGER_INVARIANT_CHECK',
                false,
            );

        if (enableInvariant) {
            await this.assertLedgerMatchesWallet(tx, walletId);
        }


        /* ─────────────────────────────────────────────
           7️⃣ STRUCTURED LOG
        ───────────────────────────────────────────── */
        this.logger.log(
            {
                event: 'ledger_tx_committed',
                entityType: 'ledger_entry',
                entityId: ledgerEntry.id,
                data: {
                    walletId,
                    delta: ledgerEntry.amount.toString(),
                    resultingBalance: updatedWallet.balance.toString(),
                    type,
                    reason,
                    referenceId: referenceId ?? null,
                    idempotencyKey,
                    campaignId: campaignId ?? null,
                    campaignTargetId: campaignTargetId ?? null,
                    escrowId: escrowId ?? null,
                    actor: actor ?? null,
                },
                correlationId,
            },
            'PaymentsService',
        );

        return ledgerEntry;
    }


    /**
     * 💰 USER DEPOSIT
     */
    async deposit(
        userId: string,
        amount: Prisma.Decimal,
        idempotencyKey: string,
    ) {
        const normalizedAmount = this.normalizeDecimal(amount);
        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Deposit amount must be positive');
        }

        return this.prisma.$transaction(async (tx) => {
            let wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                wallet = await tx.wallet.create({
                    data: {
                        userId,
                        balance: new Prisma.Decimal(0),
                    },
                });
            }

            const existing = await tx.ledgerEntry.findUnique({
                where: { idempotencyKey },
            });

            if (existing) {
                return { ok: true, idempotent: true };
            }

            await this.recordWalletMovement({
                tx,
                walletId: wallet.id,
                amount: normalizedAmount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                settlementStatus: 'non_settlement',
                idempotencyKey,
                actor: TransitionActor.system,
                correlationId: `deposit:${userId}:${idempotencyKey}`,
            });

            await tx.userAuditLog.create({
                data: {
                    userId,
                    action: 'wallet_deposit',
                    metadata: {
                        amount: normalizedAmount.toFixed(2),
                        idempotencyKey,
                    },
                },
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
        options?: { transaction?: Prisma.TransactionClient; actor?: TransitionActor; correlationId?: string },
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

            const allowed: CampaignTargetStatus[] = [
                CampaignTargetStatus.submitted,
                CampaignTargetStatus.approved,
            ];

            if (!allowed.includes(target.status)) {
                this.logger.warn({
                    event: 'escrow_hold_invalid_status',
                    entityType: 'campaign_target',
                    entityId: campaignTargetId,
                    data: { currentStatus: target.status },
                },
                    'PaymentsService',
                );

                throw new ConflictException(
                    `Escrow hold requires campaign target ${campaignTargetId} to be submitted/approved (current: ${target.status})`,
                );
            }


            if (target.campaign.status !== CampaignStatus.active) {
                throw new ConflictException(
                    `Campaign ${target.campaignId} is not active`,
                );
            }

            const advertiserWallet = target.campaign.advertiser.wallet;
            const publisherWallet = target.channel.owner.wallet;

            if (!advertiserWallet || !publisherWallet) {
                throw new BadRequestException('Wallets not configured');
            }

            const amount = this.normalizeDecimal(target.price);
            this.assertEscrowAmountSafe(amount, campaignTargetId);
            const totalBudget = this.normalizeDecimal(target.campaign.totalBudget);
            const spentBudget = this.normalizeDecimal(target.campaign.spentBudget ?? new Prisma.Decimal(0));
            const remainingBudget = totalBudget.sub(spentBudget);
            if (remainingBudget.lt(amount)) {
                throw new ConflictException(
                    `Campaign ${target.campaignId} budget exceeded`,
                );
            }

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
                actor: options?.actor ?? TransitionActor.system,
                correlationId: options?.correlationId ?? campaignTargetId,
            });


            const escrow = await tx.escrow.create({
                data: {
                    campaignTargetId,
                    advertiserWalletId: advertiserWallet.id,
                    publisherWalletId: publisherWallet.id,
                    amount,
                    status: EscrowStatus.held,
                },
            });

            this.logger.log(
                {
                    event: 'escrow_hold_created',
                    entityType: 'escrow',
                    entityId: escrow.id,
                    data: {
                        campaignTargetId,
                        amount: amount.toFixed(2),
                        advertiserWalletId: advertiserWallet.id,
                        publisherWalletId: publisherWallet.id,
                    },
                    correlationId: options?.correlationId ?? campaignTargetId,
                },
                'PaymentsService',
            );

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
