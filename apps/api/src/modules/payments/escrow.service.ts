import { BadRequestException, Injectable, ConflictException, Inject, LoggerService } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

import {
    CampaignTargetStatus,
    EscrowStatus,
    KillSwitchKey,
    Prisma,
    Escrow,
} from '@prisma/client';
import { PaymentsService } from './payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import {
    assertCampaignTargetExists,
    assertCampaignTargetTransition,
    assertEscrowCampaignTargetInvariant,
    assertEscrowTransition,
    assertPostJobOutcomeForEscrow,
} from '@/modules/lifecycle/lifecycle';
import {
    LedgerReason,
    LedgerType,
    TransitionActor,
    UserRole,
} from '@/modules/domain/contracts';


@Injectable()
export class EscrowService {
  

    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
        private readonly killSwitchService: KillSwitchService,
        @Inject('LOGGER') private readonly logger: LoggerService
    ) { }

    private static readonly MAX_ESCROW_AMOUNT = new Prisma.Decimal('999999999999.99');

    private assertEscrowAmountSafe(
        amount: Prisma.Decimal,
        escrow: Escrow,
        campaignTargetId: string,
        actor: TransitionActor,
    ) {
        const normalized = new Prisma.Decimal(amount);
        const decimals = normalized.decimalPlaces();

        if (decimals > 2 || normalized.abs().gt(EscrowService.MAX_ESCROW_AMOUNT)) {
            this.logger.error({
                event: 'escrow_amount_invalid_precision',
                alert: true,
                entityType: 'escrow',
                entityId: escrow.id,
                actorId: actor,
                data: {
                    campaignTargetId,
                    amount: normalized.toFixed(2),
                    decimals,
                    max: EscrowService.MAX_ESCROW_AMOUNT.toFixed(2),
                },
                correlationId: campaignTargetId,
            },
                'EscrowService',
            );

            throw new ConflictException('Escrow amount precision invalid');
        }
    }

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
        options?: {
            transaction?: Prisma.TransactionClient;
            actor?: TransitionActor;
            correlationId?: string;
        }
,
    ) {
        const actor = options?.actor ?? TransitionActor.system;
        const correlationId = options?.correlationId ?? campaignTargetId;
        const execute = async (tx: Prisma.TransactionClient) => {
            await this.killSwitchService.assertEnabled({
                key: KillSwitchKey.payouts,
                reason: 'Payouts paused',
                correlationId,
            });

            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);
            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }


            // ─────────────────────────────────────────────
            // 🔒 OPERATION CLAIM (GLOBAL IDEMPOTENCY)
            // ─────────────────────────────────────────────
            const opKey = `escrow:release:${campaignTargetId}`;

            const existingOp = await tx.financialAuditEvent.findUnique({
                where: { idempotencyKey: opKey },
            });

            if (existingOp) {
                return { ok: true, alreadyReleased: true };
            }

            await tx.financialAuditEvent.create({
                data: {
                    idempotencyKey: opKey,
                    walletId: escrow.publisherWalletId, // ✅ MUHIM
                    escrowId: escrow.id,
                    campaignTargetId,
                    type: LedgerType.credit, // semantic emas, audit-marker
                    amount: new Prisma.Decimal(0),
                    reason: LedgerReason.payout,
                    actor,
                    correlationId,
                },
            });


            // 🔐 INTERMEDIATE STATUS GUARD (BANK-GRADE)
            // 🔐 1️⃣ ATOMIC STATE CLAIM: held → releasing
            const updated = await tx.escrow.updateMany({
                where: {
                    id: escrow.id,
                    status: EscrowStatus.held,
                },
                data: {
                    status: EscrowStatus.releasing,
                },
            });

            // 🔁 2️⃣ IDEMPOTENCY / INVALID STATE GUARD
            if (updated.count === 0) {
                if (escrow.status === EscrowStatus.released) {
                    return { ok: true, alreadyReleased: true };
                }

                throw new ConflictException(
                    `Escrow ${escrow.id} in invalid state ${escrow.status}`,
                );
            }

            // 🔄 3️⃣ RE-READ ESCROW (DB = SOURCE OF TRUTH)
            const escrowAfter = await tx.escrow.findUnique({
                where: { id: escrow.id },
            });

            if (!escrowAfter) {
                throw new BadRequestException('Escrow not found after state transition');
            }

            // 🔍 4️⃣ LOAD CAMPAIGN TARGET
            const campaignTarget = await tx.campaignTarget.findUnique({
                where: { id: campaignTargetId },
                include: { postJob: true },
            });

            assertCampaignTargetExists(
                campaignTargetId,
                Boolean(campaignTarget),
            );

            // 🧠 5️⃣ FSM: held → releasing
            assertEscrowTransition({
                escrowId: escrow.id,
                from: EscrowStatus.held,
                to: EscrowStatus.releasing,
                actor,
                correlationId,
            });

            // 🧠 6️⃣ FSM: releasing → released
            assertEscrowTransition({
                escrowId: escrow.id,
                from: escrowAfter.status,
                to: EscrowStatus.released,
                actor,
                correlationId,
            });



            assertPostJobOutcomeForEscrow({
                campaignTargetId,
                postJobStatus: campaignTarget!.postJob?.status ?? null,
                action: 'release',
                actor,
            });

            const targetTransition = assertCampaignTargetTransition({
                campaignTargetId,
                from: campaignTarget!.status,
                to: CampaignTargetStatus.posted,
                actor,
                correlationId,
            });

            const total = new Prisma.Decimal(escrow.amount);
            this.assertEscrowAmountSafe(total, escrow, campaignTargetId, actor);

            const commission = await tx.platformCommission.findUnique({
                where: { campaignTargetId },
            });

            const { commissionAmount, payoutAmount } =
                this.paymentsService.calculateCommissionSplit(total, commission);

            const expectedTotal = payoutAmount.add(commissionAmount);
            if (!expectedTotal.equals(total)) {
                this.logger.error({
                    event: 'escrow_amount_mismatch',
                    alert: true,
                    entityType: 'campaign_target',
                    entityId: campaignTargetId,
                    actorId: actor,
                    data: {
                        escrowId: escrow.id,
                        escrowAmount: total.toFixed(2),
                        expectedAmount: expectedTotal.toFixed(2),
                    },
                    correlationId,
                },
                    'EscrowService',
                );

                throw new ConflictException(
                    `Escrow amount mismatch for campaignTarget=${campaignTargetId}`,
                );
            }

            const holdLedger = await tx.ledgerEntry.findFirst({
                where: {
                    walletId: escrow.advertiserWalletId,
                    reason: LedgerReason.escrow_hold,
                    referenceId: campaignTargetId,
                },
            });

            if (
                !holdLedger ||
                !new Prisma.Decimal(holdLedger.amount).abs().equals(total)
            ) {
                this.logger.error({
                    event: 'escrow_hold_ledger_mismatch',
                    alert: true,
                    entityType: 'campaign_target',
                    entityId: campaignTargetId,
                    actorId: actor,
                    data: {
                        escrowId: escrow.id,
                        escrowAmount: total.toFixed(2),
                        ledgerAmount: holdLedger
                            ? new Prisma.Decimal(holdLedger.amount).toFixed(2)
                            : null,
                    },
                    correlationId,
                },
                    undefined,
                    'EscrowService',
                );

                throw new ConflictException(
                    `Escrow hold ledger mismatch for campaignTarget=${campaignTargetId}`,
                );
            }

            // 1️⃣ PAYOUT → PUBLISHER
            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.publisherWalletId,
                amount: payoutAmount,
                type: LedgerType.credit,
                reason: LedgerReason.payout,
                settlementStatus: 'settled',
                referenceId: campaignTargetId,
                idempotencyKey: `payout:${campaignTargetId}`,
                campaignId: campaignTarget!.campaignId,
                campaignTargetId,
                escrowId: escrow.id,
                actor,
                correlationId,
            });

            let platformWalletId: string | null = null;
            // 2️⃣ COMMISSION → PLATFORM
            if (commissionAmount.gt(0)) {
                const platformWallet = await tx.wallet.findFirst({
                    where: { user: { role: UserRole.super_admin } },
                });

                if (!platformWallet) {
                    throw new BadRequestException('Platform wallet not configured');
                }

                platformWalletId = platformWallet.id;
                await this.paymentsService.recordWalletMovement({
                    tx,
                    walletId: platformWallet.id,
                    amount: commissionAmount,
                    type: LedgerType.credit,
                    reason: LedgerReason.commission,
                    settlementStatus: 'settled',
                    referenceId: campaignTargetId,
                    idempotencyKey: `commission:${campaignTargetId}`,
                    campaignId: campaignTarget!.campaignId,
                    campaignTargetId,
                    escrowId: escrow.id,
                    actor,
                    correlationId,
                });
            }

            // 3️⃣ FINALIZE ESCROW
            if (!targetTransition.noop) {
                await tx.campaignTarget.update({
                    where: { id: campaignTargetId },
                    data: { status: CampaignTargetStatus.posted },
                });
            }

            await tx.campaign.update({
                where: { id: campaignTarget!.campaignId },
                data: { spentBudget: { increment: total } },
            });

            await tx.escrow.update({
                where: { id: escrow.id },
                data: {
                    status: EscrowStatus.released,
                    releasedAt: new Date(),
                },
            });

   

            if (platformWalletId) {
                await this.paymentsService.ensureWalletInvariant(
                    tx,
                    platformWalletId,
                );
            }
            this.logger.log({
                event: 'escrow_released',
                entityType: 'escrow',
                entityId: escrow.id,
                actorId: actor,
                data: {
                    campaignTargetId,
                    payout: payoutAmount.toFixed(2),
                    commission: commissionAmount.toFixed(2),
                    platformWalletId,
                },
                correlationId,
            },
                'EscrowService',
            );


            return {
                ok: true,
                payout: payoutAmount.toFixed(2),
                commission: commissionAmount.toFixed(2),
            };
        };

        if (options?.transaction) {
            return execute(options.transaction);
        }

        return this.prisma.$transaction(execute);
    }

    /**
     * REFUND ESCROW
     * Called when post failed / rejected / cancelled
     */
    async refund(
        campaignTargetId: string,
        options?: {
            reason?: string;
            transaction?: Prisma.TransactionClient;
            actor?: TransitionActor;
            correlationId?: string;
        },
    ) {
        const actor = options?.actor ?? TransitionActor.system;
        const reason = options?.reason ?? 'post_failed';
        const correlationId = options?.correlationId ?? campaignTargetId;
        const execute = async (tx: Prisma.TransactionClient) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);
            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            const opKey = `escrow:refund:${campaignTargetId}`;

            const existingOp = await tx.financialAuditEvent.findUnique({
                where: { idempotencyKey: opKey },
            });

            if (existingOp) {
                return { ok: true, alreadyRefunded: true };
            }

            await tx.financialAuditEvent.create({
                data: {
                    idempotencyKey: opKey,
                    walletId: escrow.advertiserWalletId, // ✅ MUHIM
                    escrowId: escrow.id,
                    campaignTargetId,
                    type: LedgerType.credit,
                    amount: new Prisma.Decimal(0),
                    reason: LedgerReason.refund,
                    actor,
                    correlationId,
                },
            });


            // 1️⃣ HELD → REFUNDING (ATOMIC GUARD)
            const updated = await tx.escrow.updateMany({
                where: {
                    id: escrow.id,
                    status: EscrowStatus.held,
                },
                data: {
                    status: EscrowStatus.refunding,
                },
            });

            // 2️⃣ IDEMPOTENCY / INVALID STATE CHECK
            if (updated.count === 0) {
                if (escrow.status === EscrowStatus.refunded) {
                    return { ok: true, alreadyRefunded: true };
                }

                throw new ConflictException(
                    `Escrow ${escrow.id} in invalid state ${escrow.status}`,
                );
            }

            // 3️⃣ RE-READ ESCROW (SOURCE OF TRUTH)
            const escrowAfter = await tx.escrow.findUnique({
                where: { id: escrow.id },
            });

            if (!escrowAfter) {
                throw new BadRequestException('Escrow not found after update');
            }

            // 4️⃣ LOAD CAMPAIGN TARGET
            const campaignTarget = await tx.campaignTarget.findUnique({
                where: { id: campaignTargetId },
                include: { postJob: true },
            });

            assertCampaignTargetExists(
                campaignTargetId,
                Boolean(campaignTarget),
            );

            // 5️⃣ FSM: HELD → REFUNDING
            assertEscrowTransition({
                escrowId: escrow.id,
                from: EscrowStatus.held,
                to: EscrowStatus.refunding,
                actor,
                correlationId,
            });

            // 6️⃣ FSM: REFUNDING → REFUNDED
            assertEscrowTransition({
                escrowId: escrow.id,
                from: escrowAfter.status,
                to: EscrowStatus.refunded,
                actor,
                correlationId,
            });



            assertPostJobOutcomeForEscrow({
                campaignTargetId,
                postJobStatus: campaignTarget!.postJob?.status ?? null,
                action: 'refund',
                actor,
            });

            const targetTransition = assertCampaignTargetTransition({
                campaignTargetId,
                from: campaignTarget!.status,
                to: CampaignTargetStatus.refunded,
                actor,
                correlationId,
            });

            const amount = new Prisma.Decimal(escrow.amount);
            this.assertEscrowAmountSafe(amount, escrow, campaignTargetId, actor);

            // 1️⃣ RETURN FUNDS → ADVERTISER
            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.advertiserWalletId,
                amount,
                type: LedgerType.credit,
                reason: LedgerReason.refund,
                settlementStatus: 'settled',
                referenceId: campaignTargetId,
                idempotencyKey: `refund:${campaignTargetId}`,
                campaignId: campaignTarget!.campaignId,
                campaignTargetId,
                escrowId: escrow.id,
                actor,
                correlationId,
            });

            // 2️⃣ FINALIZE ESCROW
            if (!targetTransition.noop) {
                await tx.campaignTarget.update({
                    where: { id: campaignTargetId },
                    data: { status: CampaignTargetStatus.refunded },
                });
            }

            await tx.escrow.update({
                where: { id: escrow.id },
                data: {
                    status: EscrowStatus.refunded,
                    refundedAt: new Date(),
                },
            });

            await this.paymentsService.ensureWalletInvariant(
                tx,
                escrow.advertiserWalletId,
            );

            this.logger.log({
                event: 'escrow_refunded',
                entityType: 'escrow',
                entityId: escrow.id,
                actorId: actor,
                data: {
                    campaignTargetId,
                    refunded: amount.toFixed(2),
                    reason,
                },
                correlationId,
            },
                'EscrowService',
            );


            return {
                ok: true,
                refunded: amount.toFixed(2),
                reason,
            };
        };

        if (options?.transaction) {
            return execute(options.transaction);
        }

        return this.prisma.$transaction(execute);
    }
}
