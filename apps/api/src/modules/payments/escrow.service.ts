import { BadRequestException, Injectable, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

import { Prisma, Escrow } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import {
    TransitionActor,
    assertCampaignTargetExists,
    assertCampaignTargetTransition,
    assertEscrowCampaignTargetInvariant,
    assertEscrowTransition,
    assertPostJobOutcomeForEscrow,
} from '@/modules/lifecycle/lifecycle';

@Injectable()
export class EscrowService {
    private readonly logger = new Logger(EscrowService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly paymentsService: PaymentsService,
        private readonly killSwitchService: KillSwitchService,
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
        options?: {
            transaction?: Prisma.TransactionClient;
            actor?: TransitionActor;
            correlationId?: string;
        },
    ) {
        const actor = options?.actor ?? 'system';
        const correlationId = options?.correlationId ?? campaignTargetId;
        const execute = async (tx: Prisma.TransactionClient) => {
            await this.killSwitchService.assertEnabled({
                key: 'payouts',
                reason: 'Payouts paused',
                correlationId,
            });

            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            const campaignTarget = await tx.campaignTarget.findUnique({
                where: { id: campaignTargetId },
                include: { postJob: true },
            });

            assertCampaignTargetExists(
                campaignTargetId,
                Boolean(campaignTarget),
            );

            if (escrow.status === 'released') {
                assertEscrowCampaignTargetInvariant({
                    campaignTargetId,
                    escrowStatus: escrow.status,
                    campaignTargetStatus: campaignTarget!.status,
                });
                return {
                    ok: true,
                    alreadyReleased: true,
                };
            }

            assertEscrowTransition({
                escrowId: escrow.id,
                from: escrow.status,
                to: 'released',
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
                to: 'posted',
                actor,
                correlationId,
            });

            const total = new Prisma.Decimal(escrow.amount);

            const commission = await tx.platformCommission.findUnique({
                where: { campaignTargetId },
            });

            const { commissionAmount, payoutAmount } =
                this.paymentsService.calculateCommissionSplit(total, commission);

            const expectedTotal = payoutAmount.add(commissionAmount);
            if (!expectedTotal.equals(total)) {
                this.logger.error(
                    JSON.stringify({
                        event: 'escrow_amount_mismatch',
                        campaignTargetId,
                        escrowAmount: total.toFixed(2),
                        payout: payoutAmount.toFixed(2),
                        commission: commissionAmount.toFixed(2),
                        correlationId,
                    }),
                );
                throw new ConflictException(
                    `Escrow amount mismatch for campaignTarget=${campaignTargetId}`,
                );
            }

            const holdLedger = await tx.ledgerEntry.findFirst({
                where: {
                    walletId: escrow.advertiserWalletId,
                    reason: 'escrow_hold',
                    referenceId: campaignTargetId,
                },
            });

            if (
                !holdLedger ||
                !new Prisma.Decimal(holdLedger.amount).abs().equals(total)
            ) {
                this.logger.error(
                    JSON.stringify({
                        event: 'escrow_hold_ledger_mismatch',
                        campaignTargetId,
                        escrowAmount: total.toFixed(2),
                        ledgerAmount: holdLedger?.amount ?? null,
                        correlationId,
                    }),
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
                type: 'credit',
                reason: 'payout',
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
                    where: { user: { role: 'super_admin' } },
                });

                if (!platformWallet) {
                    throw new BadRequestException('Platform wallet not configured');
                }

                platformWalletId = platformWallet.id;
                await this.paymentsService.recordWalletMovement({
                    tx,
                    walletId: platformWallet.id,
                    amount: commissionAmount,
                    type: 'credit',
                    reason: 'commission',
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
                    data: { status: 'posted' },
                });
            }

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

            this.logger.warn(
                JSON.stringify({
                    event: 'escrow_released',
                    campaignTargetId,
                    escrowId: escrow.id,
                    payout: payoutAmount.toFixed(2),
                    commission: commissionAmount.toFixed(2),
                    actor,
                    correlationId,
                }),
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
        const actor = options?.actor ?? 'system';
        const reason = options?.reason ?? 'post_failed';
        const correlationId = options?.correlationId ?? campaignTargetId;
        const execute = async (tx: Prisma.TransactionClient) => {
            // 🔒 LOCK ESCROW ROW
            const escrow = await this.lockEscrow(tx, campaignTargetId);

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            const campaignTarget = await tx.campaignTarget.findUnique({
                where: { id: campaignTargetId },
                include: { postJob: true },
            });

            assertCampaignTargetExists(
                campaignTargetId,
                Boolean(campaignTarget),
            );

            if (escrow.status === 'refunded') {
                assertEscrowCampaignTargetInvariant({
                    campaignTargetId,
                    escrowStatus: escrow.status,
                    campaignTargetStatus: campaignTarget!.status,
                });
                return {
                    ok: true,
                    alreadyRefunded: true,
                };
            }

            assertEscrowTransition({
                escrowId: escrow.id,
                from: escrow.status,
                to: 'refunded',
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
                to: 'refunded',
                actor,
                correlationId,
            });

            const amount = new Prisma.Decimal(escrow.amount);

            // 1️⃣ RETURN FUNDS → ADVERTISER
            await this.paymentsService.recordWalletMovement({
                tx,
                walletId: escrow.advertiserWalletId,
                amount,
                type: 'credit',
                reason: 'refund',
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
                    data: { status: 'refunded' },
                });
            }

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

            this.logger.warn(
                JSON.stringify({
                    event: 'escrow_refunded',
                    campaignTargetId,
                    escrowId: escrow.id,
                    refunded: amount.toFixed(2),
                    actor,
                    correlationId,
                    reason,
                }),
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