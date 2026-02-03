
import { PrismaService } from '@/prisma/prisma.service';
import {
    CampaignTargetStatus,
    CampaignStatus,
    EscrowStatus,
    KillSwitchKey,
    PaymentIntentStatus,
    Prisma,
    WithdrawalIntentStatus,
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
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';


@Injectable()
export class PaymentsService {


    constructor(
        private readonly prisma: PrismaService,
        private readonly killSwitchService: KillSwitchService,
        private readonly configService: ConfigService,
        private readonly clickPaymentService: ClickPaymentService,
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

    verifyClickSignature(payload: Record<string, string | number | null>) {
        return this.clickPaymentService.verifyWebhookSignature(payload);
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


    async createDepositIntent(params: {
        userId: string;
        amount: Prisma.Decimal;
        idempotencyKey: string;
        returnUrl?: string;
    }) {
        const { userId, amount, idempotencyKey, returnUrl } = params;
        const normalizedAmount = this.normalizeDecimal(amount);
        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Deposit amount must be positive');
        }

        const enableClick = this.configService.get<boolean>(
            'ENABLE_CLICK_PAYMENTS',
            false,
        );
        if (!enableClick) {
            throw new ConflictException('Click payments are disabled');
        }

        const intent = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.paymentIntent.findUnique({
                where: { idempotencyKey },
            });
            if (existing) {
                return existing;
            }

            let wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet) {
                wallet = await tx.wallet.create({
                    data: {
                        userId,
                        balance: new Prisma.Decimal(0),
                    },
                });
            }

            return tx.paymentIntent.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    amount: normalizedAmount,
                    currency: wallet.currency,
                    provider: 'click',
                    status: PaymentIntentStatus.pending,
                    idempotencyKey,
                },
            });
        });

        const invoice = await this.clickPaymentService.createInvoice({
            amount: normalizedAmount.toFixed(2),
            merchantTransId: intent.id,
            description: `Wallet deposit ${intent.id}`,
            returnUrl,
        });

        const updated = await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
                providerInvoiceId: invoice.invoice_id,
                paymentUrl: invoice.payment_url,
            },
        });

        this.logger.log(
            {
                event: 'deposit_intent_created',
                entityType: 'payment_intent',
                entityId: updated.id,
                data: {
                    userId,
                    amount: normalizedAmount.toFixed(2),
                    provider: 'click',
                    providerInvoiceId: invoice.invoice_id,
                },
            },
            'PaymentsService',
        );

        return updated;
    }

    async finalizeDepositIntent(params: {
        payload: Record<string, string | number | null>;
        verified: boolean;
    }) {
        const { payload, verified } = params;
        if (!verified) {
            this.logger.error(
                {
                    event: 'click_webhook_invalid_signature',
                    payload,
                },
                'PaymentsService',
            );
            throw new BadRequestException('Click webhook signature invalid');
        }

        const intentId = String(payload['merchant_trans_id'] ?? '');
        if (!intentId) {
            throw new BadRequestException('Missing merchant_trans_id');
        }

        const intent = await this.prisma.paymentIntent.findUnique({
            where: { id: intentId },
        });

        if (!intent) {
            throw new BadRequestException('Payment intent not found');
        }

        if (intent.status === PaymentIntentStatus.succeeded) {
            return { ok: true, idempotent: true };
        }

        const errorCode = Number(payload['error'] ?? 0);
        const isSuccess = errorCode === 0;

        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.paymentIntent.findUnique({
                where: { id: intent.id },
            });

            if (!locked) {
                throw new BadRequestException('Payment intent not found');
            }

            if (locked.status === PaymentIntentStatus.succeeded) {
                return { ok: true, idempotent: true };
            }

            if (!isSuccess) {
                await tx.paymentIntent.update({
                    where: { id: intent.id },
                    data: {
                        status: PaymentIntentStatus.failed,
                        failedAt: new Date(),
                        providerTxnId: String(payload['click_trans_id'] ?? ''),
                        metadata: payload as Prisma.JsonObject,
                    },
                });

                await tx.userAuditLog.create({
                    data: {
                        userId: intent.userId,
                        action: 'deposit_failed',
                        metadata: {
                            intentId: intent.id,
                            provider: 'click',
                            payload,
                        },
                    },
                });

                return { ok: false, status: 'failed' as const };
            }

            const walletId = intent.walletId;
            if (!walletId) {
                throw new BadRequestException('Wallet missing for intent');
            }

            await this.recordWalletMovement({
                tx,
                walletId,
                amount: intent.amount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                settlementStatus: 'non_settlement',
                idempotencyKey: `deposit_intent:${intent.id}`,
                actor: TransitionActor.payment_provider,
                correlationId: `deposit_intent:${intent.id}`,
            });

            await tx.paymentIntent.update({
                where: { id: intent.id },
                data: {
                    status: PaymentIntentStatus.succeeded,
                    succeededAt: new Date(),
                    providerTxnId: String(payload['click_trans_id'] ?? ''),
                    metadata: payload as Prisma.JsonObject,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: intent.userId,
                    action: 'deposit_succeeded',
                    metadata: {
                        intentId: intent.id,
                        provider: 'click',
                        payload,
                    },
                },
            });

            return { ok: true };
        });
    }

    async reconcileDepositIntent(intentId: string) {
        const intent = await this.prisma.paymentIntent.findUnique({
            where: { id: intentId },
        });
        if (!intent) {
            throw new BadRequestException('Payment intent not found');
        }

        if (intent.status !== PaymentIntentStatus.pending) {
            return { ok: true, status: intent.status };
        }

        const status = await this.clickPaymentService.getInvoiceStatus({
            merchantTransId: intent.id,
        });

        if (status.status !== 'paid') {
            return { ok: true, status: intent.status };
        }

        await this.finalizeDepositIntent({
            payload: {
                merchant_trans_id: intent.id,
                click_trans_id: status.click_trans_id ?? '',
                error: 0,
                amount: intent.amount.toFixed(2),
            },
            verified: true,
        });

        return { ok: true, status: PaymentIntentStatus.succeeded };
    }

    async reconcilePendingDepositIntents(params: { olderThanMinutes: number }) {
        const cutoff = new Date(Date.now() - params.olderThanMinutes * 60_000);
        const intents = await this.prisma.paymentIntent.findMany({
            where: {
                status: PaymentIntentStatus.pending,
                createdAt: { lt: cutoff },
            },
            orderBy: { createdAt: 'asc' },
            take: 50,
        });

        if (intents.length) {
            this.logger.warn(
                {
                    event: 'deposit_intent_backlog',
                    count: intents.length,
                    olderThanMinutes: params.olderThanMinutes,
                },
                'PaymentsService',
            );
        }

        for (const intent of intents) {
            try {
                await this.reconcileDepositIntent(intent.id);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(
                    {
                        event: 'deposit_intent_reconcile_failed',
                        intentId: intent.id,
                        error: message,
                    },
                    'PaymentsService',
                );
            }
        }

        return { ok: true, processed: intents.length };
    }

    async createWithdrawalIntent(params: {
        userId: string;
        amount: Prisma.Decimal;
        idempotencyKey: string;
    }) {
        const { userId, amount, idempotencyKey } = params;
        const normalizedAmount = this.normalizeDecimal(amount);
        if (normalizedAmount.lte(0)) {
            throw new BadRequestException('Withdrawal amount must be positive');
        }

        const enableWithdrawals = this.configService.get<boolean>(
            'ENABLE_WITHDRAWALS',
            false,
        );
        if (!enableWithdrawals) {
            throw new ConflictException('Withdrawals are disabled');
        }

        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.withdrawalIntent.findUnique({
                where: { idempotencyKey },
            });
            if (existing) {
                return existing;
            }

            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });
            if (!wallet) {
                throw new BadRequestException('Wallet not found');
            }

            if (wallet.balance.lt(normalizedAmount)) {
                throw new BadRequestException('Insufficient balance');
            }

            return tx.withdrawalIntent.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    amount: normalizedAmount,
                    currency: wallet.currency,
                    provider: 'click',
                    status: WithdrawalIntentStatus.pending,
                    idempotencyKey,
                },
            });
        });
    }

    async finalizeWithdrawalIntent(params: {
        payload: Record<string, string | number | null>;
        verified: boolean;
    }) {
        const { payload, verified } = params;
        if (!verified) {
            this.logger.error(
                {
                    event: 'click_withdrawal_webhook_invalid_signature',
                    payload,
                },
                'PaymentsService',
            );
            throw new BadRequestException('Click webhook signature invalid');
        }

        const intentId = String(payload['merchant_trans_id'] ?? '');
        if (!intentId) {
            throw new BadRequestException('Missing merchant_trans_id');
        }

        const intent = await this.prisma.withdrawalIntent.findUnique({
            where: { id: intentId },
        });

        if (!intent) {
            throw new BadRequestException('Withdrawal intent not found');
        }

        if (intent.status === WithdrawalIntentStatus.succeeded) {
            return { ok: true, idempotent: true };
        }

        const errorCode = Number(payload['error'] ?? 0);
        const isSuccess = errorCode === 0;

        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.withdrawalIntent.findUnique({
                where: { id: intent.id },
            });

            if (!locked) {
                throw new BadRequestException('Withdrawal intent not found');
            }

            if (locked.status === WithdrawalIntentStatus.succeeded) {
                return { ok: true, idempotent: true };
            }

            if (!isSuccess) {
                await tx.withdrawalIntent.update({
                    where: { id: intent.id },
                    data: {
                        status: WithdrawalIntentStatus.failed,
                        failedAt: new Date(),
                        providerTxnId: String(payload['click_trans_id'] ?? ''),
                        metadata: payload as Prisma.JsonObject,
                    },
                });

                await tx.userAuditLog.create({
                    data: {
                        userId: intent.userId,
                        action: 'withdrawal_failed',
                        metadata: {
                            intentId: intent.id,
                            provider: 'click',
                            payload,
                        },
                    },
                });

                return { ok: false, status: 'failed' as const };
            }

            await this.recordWalletMovement({
                tx,
                walletId: intent.walletId,
                amount: intent.amount,
                type: LedgerType.debit,
                reason: LedgerReason.withdrawal,
                idempotencyKey: `withdrawal_intent:${intent.id}`,
                actor: TransitionActor.payment_provider,
                correlationId: `withdrawal_intent:${intent.id}`,
            });

            await tx.withdrawalIntent.update({
                where: { id: intent.id },
                data: {
                    status: WithdrawalIntentStatus.succeeded,
                    succeededAt: new Date(),
                    providerTxnId: String(payload['click_trans_id'] ?? ''),
                    metadata: payload as Prisma.JsonObject,
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: intent.userId,
                    action: 'withdrawal_succeeded',
                    metadata: {
                        intentId: intent.id,
                        provider: 'click',
                        payload,
                    },
                },
            });

            return { ok: true };
        });
    }

    async reconcileWithdrawalIntent(intentId: string) {
        const intent = await this.prisma.withdrawalIntent.findUnique({
            where: { id: intentId },
        });
        if (!intent) {
            throw new BadRequestException('Withdrawal intent not found');
        }

        if (intent.status !== WithdrawalIntentStatus.pending) {
            return { ok: true, status: intent.status };
        }

        const status = await this.clickPaymentService.getInvoiceStatus({
            merchantTransId: intent.id,
        });

        if (status.status !== 'paid') {
            return { ok: true, status: intent.status };
        }

        await this.finalizeWithdrawalIntent({
            payload: {
                merchant_trans_id: intent.id,
                click_trans_id: status.click_trans_id ?? '',
                error: 0,
                amount: intent.amount.toFixed(2),
            },
            verified: true,
        });

        return { ok: true, status: WithdrawalIntentStatus.succeeded };
    }

    async reconcilePendingWithdrawalIntents(params: { olderThanMinutes: number }) {
        const cutoff = new Date(Date.now() - params.olderThanMinutes * 60_000);
        const intents = await this.prisma.withdrawalIntent.findMany({
            where: {
                status: WithdrawalIntentStatus.pending,
                createdAt: { lt: cutoff },
            },
            orderBy: { createdAt: 'asc' },
            take: 50,
        });

        if (intents.length) {
            this.logger.warn(
                {
                    event: 'withdrawal_intent_backlog',
                    count: intents.length,
                    olderThanMinutes: params.olderThanMinutes,
                },
                'PaymentsService',
            );
        }

        for (const intent of intents) {
            try {
                await this.reconcileWithdrawalIntent(intent.id);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(
                    {
                        event: 'withdrawal_intent_reconcile_failed',
                        intentId: intent.id,
                        error: message,
                    },
                    'PaymentsService',
                );
            }
        }

        return { ok: true, processed: intents.length };
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