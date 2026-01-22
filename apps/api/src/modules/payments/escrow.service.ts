import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

import { Prisma, Escrow } from '@prisma/client';
import { PaymentsService } from './payments.service';
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
        options?: {
            transaction?: Prisma.TransactionClient;
            actor?: TransitionActor;
        },
    ) {
        const actor = options?.actor ?? 'system';
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
            });

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
        },
    ) {
        const actor = options?.actor ?? 'system';
        const reason = options?.reason ?? 'post_failed';
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
            });

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
