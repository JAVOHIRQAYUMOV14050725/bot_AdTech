

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
    UnauthorizedException,
    HttpException,
    Inject,
    Injectable,
    LoggerService,
    ServiceUnavailableException,
} from '@nestjs/common';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import {
    LedgerReason,
    LedgerType,
    TransitionActor,
} from '@/modules/domain/contracts';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';
import { loadEnv } from '@/config/env';
import { RequestContext } from '@/common/context/request-context';

const env = loadEnv()



const ENABLE_CLICK = env.ENABLE_CLICK
const ENABLE_CLICK_PAYMENTS = env.ENABLE_CLICK_PAYMENTS
const CLICK_API_BASE_URL = env.CLICK_API_BASE_URL
const CLICK_MERCHANT_ID = env.CLICK_MERCHANT_ID
const CLICK_SECRET_KEY = env.CLICK_SECRET_KEY
const CLICK_SERVICE_ID = env.CLICK_SERVICE_ID





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

    private extractHttpExceptionDetails(error: unknown): {
        status: number | null;
        code: string | null;
        correlationId: string | null;
        details: Record<string, unknown> | null;
    } {
        if (!(error instanceof HttpException)) {
            return { status: null, code: null, correlationId: null, details: null };
        }

        const response = error.getResponse();
        const status = error.getStatus();
        if (!response || typeof response !== 'object') {
            return { status, code: null, correlationId: null, details: null };
        }

        const record = response as Record<string, unknown>;
        const details =
            record.details && typeof record.details === 'object'
                ? (record.details as Record<string, unknown>)
                : null;
        const code =
            typeof record.code === 'string'
                ? record.code
                : typeof details?.code === 'string'
                    ? (details.code as string)
                    : null;
        const correlationId =
            typeof record.correlationId === 'string'
                ? record.correlationId
                : typeof details?.correlationId === 'string'
                    ? (details.correlationId as string)
                    : null;

        return { status, code, correlationId, details };
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

    private assertClickPayloadSafe(params: {
        payload: Record<string, string | number | null>;
        expectedAmount?: Prisma.Decimal;
    }) {
        const { payload, expectedAmount } = params;
        const verified = this.clickPaymentService.verifyWebhookSignature(payload);
        if (!verified) {
            throw new UnauthorizedException('Click webhook signature invalid');
        }

        const serviceId = this.configService.get<string>('CLICK_SERVICE_ID', '');
        const merchantId = this.configService.get<string>('CLICK_MERCHANT_ID', '');

        if (serviceId && String(payload['service_id'] ?? '') !== serviceId) {
            throw new BadRequestException('Click service_id mismatch');
        }

        if (merchantId && String(payload['merchant_id'] ?? '') !== merchantId) {
            throw new BadRequestException('Click merchant_id mismatch');
        }

        const signTimeRaw = String(payload['sign_time'] ?? '');
        const signTimeNumber = Number(signTimeRaw);
        const signTime = Number.isFinite(signTimeNumber)
            ? new Date(signTimeNumber > 1e12 ? signTimeNumber : signTimeNumber * 1000)
            : new Date(signTimeRaw);

        if (Number.isNaN(signTime.getTime())) {
            throw new BadRequestException('Click sign_time invalid');
        }

        const maxSkewMinutes = this.configService.get<number>(
            'CLICK_SIGN_TIME_WINDOW_MINUTES',
            10,
        );
        const deltaMs = Math.abs(Date.now() - signTime.getTime());
        if (deltaMs > maxSkewMinutes * 60 * 1000) {
            throw new BadRequestException('Click sign_time expired');
        }

        if (expectedAmount) {
            const amount = new Prisma.Decimal(String(payload['amount'] ?? '0'));
            if (!amount.equals(expectedAmount)) {
                throw new BadRequestException('Click amount mismatch');
            }
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



    private static readonly ESCROW_POOL_SYSTEM_KEY = 'ESCROW_POOL';

    async ensureSystemWallet(
        tx: Prisma.TransactionClient,
        systemKey: string = PaymentsService.ESCROW_POOL_SYSTEM_KEY,
    ) {
        const existing = await tx.wallet.findUnique({ where: { systemKey } });
        if (existing) {
            return existing;
        }

        return tx.wallet.create({
            data: {
                systemKey,
                balance: new Prisma.Decimal(0),
                currency: 'USD',
            },
        });
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
        groupId?: string;
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
            groupId,
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

        const existing = await tx.ledgerEntry.findUnique({
            where: { idempotencyKey },
        });

        if (existing) {
            return existing;
        }

        let updatedWallet;
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

            updatedWallet = await tx.wallet.findUnique({
                where: { id: walletId },
                select: { balance: true },
            });
        } else {
            updatedWallet = await tx.wallet.update({
                where: { id: walletId },
                data: { balance: { increment: normalizedAmount } },
                select: { balance: true },
            });
        }

        if (!updatedWallet) {
            throw new BadRequestException('Wallet not found');
        }

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
                groupId: groupId ?? correlationId ?? null,
            },
        });

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

        const enableInvariant =
            this.configService.get<boolean>(
                'ENABLE_LEDGER_INVARIANT_CHECK',
                false,
            );

        if (enableInvariant) {
            await this.assertLedgerMatchesWallet(tx, walletId);
        }


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
                    groupId: groupId ?? correlationId ?? null,
                },
                correlationId,
            },
            'PaymentsService',
        );

        return ledgerEntry;
    }

    async transfer(params: {
        tx: Prisma.TransactionClient;
        sourceWalletId: string;
        destinationWalletId: string;
        amount: Prisma.Decimal;
        reason: LedgerReason;
        idempotencyKey: string;
        referenceId?: string;
        campaignId?: string;
        campaignTargetId?: string;
        escrowId?: string;
        actor?: TransitionActor;
        correlationId?: string;
        groupId?: string;
    }) {
        const {
            tx,
            sourceWalletId,
            destinationWalletId,
            amount,
            reason,
            idempotencyKey,
            referenceId,
            campaignId,
            campaignTargetId,
            escrowId,
            actor,
            correlationId,
            groupId,
        } = params;

        const transferGroupId = groupId ?? correlationId ?? idempotencyKey;
        const debitKey = `${idempotencyKey}:debit`;
        const creditKey = `${idempotencyKey}:credit`;

        const existingDebit = await tx.ledgerEntry.findUnique({
            where: { idempotencyKey: debitKey },
        });
        const existingCredit = await tx.ledgerEntry.findUnique({
            where: { idempotencyKey: creditKey },
        });

        if (existingDebit && existingCredit) {
            return { debitEntry: existingDebit, creditEntry: existingCredit };
        }

        const debitEntry = await this.recordWalletMovement({
            tx,
            walletId: sourceWalletId,
            amount,
            type: LedgerType.debit,
            reason,
            referenceId,
            idempotencyKey: debitKey,
            campaignId,
            campaignTargetId,
            escrowId,
            actor,
            correlationId,
            groupId: transferGroupId,
        });

        const creditEntry = await this.recordWalletMovement({
            tx,
            walletId: destinationWalletId,
            amount,
            type: LedgerType.credit,
            reason,
            settlementStatus: 'settled',
            referenceId,
            idempotencyKey: creditKey,
            campaignId,
            campaignTargetId,
            escrowId,
            actor,
            correlationId,
            groupId: transferGroupId,
        });

        return { debitEntry, creditEntry };
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

        const publicBaseUrl = (this.configService.get<string>('PUBLIC_BASE_URL', 'http://localhost:4002') || 'http://localhost:4002')
            .replace(/\/+$/, '');
        const resolvedReturnUrl = returnUrl ?? `${publicBaseUrl}/api/payments/click/return`;

        const enableClick =
            this.configService.get<boolean>('ENABLE_CLICK', false)
            || this.configService.get<boolean>('ENABLE_CLICK_PAYMENTS', false);
        if (!enableClick) {
            throw new ServiceUnavailableException({
                message: 'Click payments are disabled',
                code: 'PAYMENTS_DISABLED',
                userMessage: '⛔ To‘lovlar hozir o‘chirilgan. Keyinroq urinib ko‘ring.',
            });
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

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { phoneNumber: true },
        });

        let invoice: { invoice_id: string; payment_url: string };
        try {
            invoice = await this.clickPaymentService.createInvoice({
                amount: normalizedAmount.toFixed(2),
                merchantTransId: intent.id,
                description: `Wallet deposit ${intent.id}`,
                returnUrl: resolvedReturnUrl,
                phoneNumber: user?.phoneNumber ?? undefined,
            });
        } catch (err) {
            const correlationId = RequestContext.getCorrelationId() ?? intent.id;
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorDetails = this.extractHttpExceptionDetails(err);
            const detailsPayload = errorDetails.details ?? {};
            const errorCode =
                typeof detailsPayload.errorCode === 'string' || typeof detailsPayload.errorCode === 'number'
                    ? detailsPayload.errorCode
                    : errorDetails.code;
            this.logger.error(
                {
                    event: 'click_invoice_create_failed',
                    correlationId,
                    data: {
                        intentId: intent.id,
                        message: errorMessage,
                        url: typeof detailsPayload.url === 'string' ? detailsPayload.url : null,
                        status: errorDetails.status,
                        errorCode: errorCode ?? null,
                        errorBodyPreview:
                            typeof detailsPayload.errorBodyPreview === 'string'
                                ? detailsPayload.errorBodyPreview
                                : null,
                    },
                },
                'PaymentsService',
            );
            await this.prisma.$transaction((tx) =>
                tx.paymentIntent.update({
                    where: { id: intent.id },
                    data: {
                        status: PaymentIntentStatus.failed,
                        failedAt: new Date(),
                        metadata: {
                            clickInvoiceError: {
                                message: errorMessage,
                                correlationId,
                                status: errorDetails.status,
                                errorCode: errorCode ?? null,
                                url: typeof detailsPayload.url === 'string' ? detailsPayload.url : null,
                                errorBodyPreview:
                                    typeof detailsPayload.errorBodyPreview === 'string'
                                        ? detailsPayload.errorBodyPreview
                                        : null,
                            },
                        },
                    },
                }),
            );
            const propagatedUserMessage =
                typeof (detailsPayload as { userMessage?: unknown }).userMessage === 'string'
                    ? ((detailsPayload as { userMessage?: string }).userMessage as string)
                    : `Payment temporarily unavailable. Error ID: ${correlationId} — please retry later.`;
            throw new ServiceUnavailableException({
                message: 'Click invoice failed',
                code: 'CLICK_INVOICE_FAILED',
                correlationId,
                userMessage: propagatedUserMessage,
            });
        }

        const paymentUrl = invoice.payment_url?.trim();
        const safePaymentUrl =
            paymentUrl && paymentUrl.toLowerCase() !== 'pending' ? paymentUrl : null;

        if (!safePaymentUrl) {
            const correlationId = RequestContext.getCorrelationId() ?? intent.id;
            this.logger.error(
                {
                    event: 'click_invoice_missing_payment_url',
                    intentId: intent.id,
                    providerInvoiceId: invoice.invoice_id || null,
                    correlationId,
                },
                'PaymentsService',
            );
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            if (!safePaymentUrl) {
                return tx.paymentIntent.update({
                    where: { id: intent.id },
                    data: {
                        status: PaymentIntentStatus.failed,
                        failedAt: new Date(),
                        providerInvoiceId: invoice.invoice_id || null,
                        paymentUrl: null,
                        metadata: {
                            clickInvoiceError: {
                                message: 'Click invoice missing payment URL',
                                correlationId: RequestContext.getCorrelationId() ?? intent.id,
                            },
                        },
                    },
                });
            }

            return tx.paymentIntent.update({
                where: { id: intent.id },
                data: {
                    providerInvoiceId: invoice.invoice_id || null,
                    paymentUrl: safePaymentUrl,
                },
            });
        });

        if (!safePaymentUrl) {
            const correlationId = RequestContext.getCorrelationId() ?? intent.id;
            throw new ServiceUnavailableException({
                message: 'Click invoice missing payment URL',
                code: 'CLICK_INVOICE_FAILED',
                correlationId,
                userMessage: `Payment temporarily unavailable. Error ID: ${correlationId} — please retry later.`,
            });
        }

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
    }) {
        const { payload } = params;

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

        try {
            this.assertClickPayloadSafe({
                payload,
                expectedAmount: intent.amount,
            });
        } catch (err) {
            this.logger.error(
                {
                    event: 'click_webhook_invalid_signature',
                    payload,
                    error: err instanceof Error ? err.message : String(err),
                },
                'PaymentsService',
            );
            throw err;
        }

        const providerTxnId = String(payload['click_trans_id'] ?? '');
        const providerInvoiceId = String(
            payload['provider_invoice_id']
            ?? payload['invoice_id']
            ?? payload['merchant_prepare_id']
            ?? intent.providerInvoiceId
            ?? '',
        );
        if (providerTxnId) {
            const existingTxn = await this.prisma.paymentIntent.findFirst({
                where: {
                    providerTxnId,
                    NOT: { id: intent.id },
                },
            });

            if (existingTxn?.status === PaymentIntentStatus.succeeded) {
                return { ok: true, idempotent: true };
            }

            if (existingTxn) {
                throw new ConflictException('Duplicate provider transaction');
            }
        }


        if (providerInvoiceId) {
            const existingInvoice = await this.prisma.paymentIntent.findFirst({
                where: {
                    providerInvoiceId,
                    NOT: { id: intent.id },
                },
            });

            if (existingInvoice?.status === PaymentIntentStatus.succeeded) {
                return { ok: true, idempotent: true };
            }

            if (existingInvoice) {
                throw new ConflictException('Duplicate provider invoice');
            }
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
                        providerTxnId,
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
                idempotencyKey: providerTxnId
                    ? `deposit_provider_txn:${providerTxnId}`
                    : providerInvoiceId
                        ? `deposit_provider_invoice:${providerInvoiceId}`
                        : `deposit_intent:${intent.id}`,
                actor: TransitionActor.payment_provider,
                correlationId: `deposit_intent:${intent.id}`,
            });

            await tx.paymentIntent.update({
                where: { id: intent.id },
                data: {
                    status: PaymentIntentStatus.succeeded,
                    succeededAt: new Date(),
                    providerTxnId,
                    providerInvoiceId: providerInvoiceId || intent.providerInvoiceId || null,
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

        const signTime = Math.floor(Date.now() / 1000);
        await this.finalizeDepositIntent({
            payload: {
                merchant_trans_id: intent.id,
                click_trans_id: status.click_trans_id ?? '',
                error: 0,
                amount: intent.amount.toFixed(2),
                sign_time: signTime,
                service_id: this.configService.get<string>('CLICK_SERVICE_ID', ''),
                merchant_id: this.configService.get<string>('CLICK_MERCHANT_ID', ''),
                action: '1',
                sign: this.clickPaymentService.buildWebhookSignature({
                    click_trans_id: status.click_trans_id ?? '',
                    service_id: this.configService.get<string>('CLICK_SERVICE_ID', ''),
                    merchant_trans_id: intent.id,
                    amount: intent.amount.toFixed(2),
                    action: '1',
                    sign_time: signTime.toString(),
                }),
            },
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

    private getWithdrawalCooldownHours() {
        return this.configService.get<number>('WITHDRAWAL_COOLDOWN_HOURS', 24);
    }

    private async enforceWithdrawalCooldown(tx: Prisma.TransactionClient, userId: string) {
        const cooldownHours = this.getWithdrawalCooldownHours();
        if (cooldownHours <= 0) {
            return;
        }

        const cooldownSince = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
        const recentDeposit = await tx.paymentIntent.findFirst({
            where: {
                userId,
                status: PaymentIntentStatus.succeeded,
                succeededAt: { gte: cooldownSince },
            },
            orderBy: { succeededAt: 'desc' },
            select: { succeededAt: true },
        });

        const recentDispute = await tx.dispute.findFirst({
            where: {
                createdAt: { gte: cooldownSince },
                OR: [
                    { openedBy: userId },
                    { adDeal: { publisherId: userId } },
                    { adDeal: { advertiserId: userId } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });

        const latestEvent = [recentDeposit?.succeededAt ?? null, recentDispute?.createdAt ?? null]
            .filter((value): value is Date => value instanceof Date)
            .sort((a, b) => b.getTime() - a.getTime())[0];

        if (latestEvent) {
            const releaseAt = new Date(latestEvent.getTime() + cooldownHours * 60 * 60 * 1000);
            throw new ConflictException(`Withdrawal cooldown is active until ${releaseAt.toISOString()}`);
        }
    }

    async adminDevTopup(params: {
        adminUserId: string;
        userId: string;
        amountUsd: Prisma.Decimal;
        note?: string;
        requestId: string;
    }) {
        const isProd = this.configService.get<string>('NODE_ENV', 'development') === 'production';
        const killSwitchEnabled = this.configService.get<boolean>('KILL_SWITCH_DEV_TOPUP', false);
        if (isProd && !killSwitchEnabled) {
            throw new ConflictException('dev-topup disabled in production');
        }

        const amount = this.normalizeDecimal(params.amountUsd);
        if (amount.lte(0)) {
            throw new BadRequestException('amountUsd must be positive');
        }

        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.financialAuditEvent.findUnique({
                where: { idempotencyKey: `dev_topup:${params.requestId}` },
            });
            if (existing) {
                const wallet = await tx.wallet.findUnique({ where: { userId: params.userId } });
                return { ok: true, idempotent: true, walletId: wallet?.id ?? null };
            }

            const wallet = await tx.wallet.upsert({
                where: { userId: params.userId },
                update: {},
                create: { userId: params.userId, balance: new Prisma.Decimal(0), currency: 'USD' },
            });

            const ledgerEntry = await this.recordWalletMovement({
                tx,
                walletId: wallet.id,
                amount,
                type: LedgerType.credit,
                reason: LedgerReason.deposit,
                settlementStatus: 'non_settlement',
                idempotencyKey: `dev_topup:${params.requestId}`,
                actor: TransitionActor.admin,
                correlationId: `dev_topup:${params.requestId}`,
            });

            await tx.userAuditLog.create({
                data: {
                    userId: params.adminUserId,
                    action: 'dev_topup',
                    metadata: { targetUserId: params.userId, amountUsd: amount.toFixed(2), note: params.note ?? null, requestId: params.requestId, ledgerEntryId: ledgerEntry.id },
                },
            });

            return { ok: true, idempotent: false, walletId: wallet.id, ledgerEntryId: ledgerEntry.id };
        });
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

            await this.enforceWithdrawalCooldown(tx, userId);

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
    }) {
        const { payload } = params;

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

        try {
            this.assertClickPayloadSafe({
                payload,
                expectedAmount: intent.amount,
            });
        } catch (err) {
            this.logger.error(
                {
                    event: 'click_withdrawal_webhook_invalid_signature',
                    payload,
                    error: err instanceof Error ? err.message : String(err),
                },
                'PaymentsService',
            );
            throw err;
        }

        const providerTxnId = String(payload['click_trans_id'] ?? '');
        if (providerTxnId) {
            const existingTxn = await this.prisma.withdrawalIntent.findFirst({
                where: {
                    providerTxnId,
                    NOT: { id: intent.id },
                },
            });

            if (existingTxn?.status === WithdrawalIntentStatus.succeeded) {
                return { ok: true, idempotent: true };
            }

            if (existingTxn) {
                throw new ConflictException('Duplicate provider transaction');
            }
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
                        providerTxnId,
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
                    providerTxnId,
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

        const signTime = Math.floor(Date.now() / 1000);
        await this.finalizeWithdrawalIntent({
            payload: {
                merchant_trans_id: intent.id,
                click_trans_id: status.click_trans_id ?? '',
                error: 0,
                amount: intent.amount.toFixed(2),
                sign_time: signTime,
                service_id: this.configService.get<string>('CLICK_SERVICE_ID', ''),
                merchant_id: this.configService.get<string>('CLICK_MERCHANT_ID', ''),
                action: '1',
                sign: this.clickPaymentService.buildWebhookSignature({
                    click_trans_id: status.click_trans_id ?? '',
                    service_id: this.configService.get<string>('CLICK_SERVICE_ID', ''),
                    merchant_trans_id: intent.id,
                    amount: intent.amount.toFixed(2),
                    action: '1',
                    sign_time: signTime.toString(),
                }),
            },
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