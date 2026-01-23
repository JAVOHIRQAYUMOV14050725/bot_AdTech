import { PrismaService } from '@/prisma/prisma.service';
import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { EscrowService } from '@/modules/payments/escrow.service';
import { ResolveAction } from './dto/resolve-escrow.dto';
import Decimal from 'decimal.js';
import {
    CampaignTargetStatus,
    EscrowStatus,
    KillSwitchKey,
    LedgerReason,
    PostJobStatus,
    Prisma,
} from '@prisma/client';
import { ReconciliationMode } from './dto/reconciliation.dto';
import { safeJsonStringify } from '@/common/serialization/sanitize';
import { postQueue } from '@/modules/scheduler/queues';
import { assertPostJobTransition } from '@/modules/lifecycle/lifecycle';

const toJsonValue = (value: unknown): Prisma.InputJsonValue | null => {
    if (value === null) {
        return null;
    }

    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }

    if (typeof value === 'object') {
        const result: Record<string, Prisma.InputJsonValue | null> = {};
        for (const [key, val] of Object.entries(
            value as Record<string, unknown>,
        )) {
            result[key] = toJsonValue(val);
        }
        return result;
    }

    return String(value);
};
@Injectable()
export class SystemService {
    private readonly logger = new Logger(SystemService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly escrowService: EscrowService,
    ) { }

    /**
     * =========================================================
     * 🔥 UNIVERSAL ESCROW RESOLVER (MANUAL OVERRIDE)
     * SUPER_ADMIN ONLY
     * =========================================================
     */
    async resolveEscrow(
        campaignTargetId: string,
        action: ResolveAction,
        reason: string,
        actorUserId: string,
    ) {
        const escrow = await this.prisma.escrow.findUnique({
            where: { campaignTargetId },
        });

        if (!escrow) {
            throw new BadRequestException('Escrow not found');
        }

        // 🧾 AUDIT (BEFORE)
        await this.prisma.userAuditLog.create({
            data: {
                userId: actorUserId,
                action: `ESCROW_${action.toUpperCase()}`,
                metadata: {
                    campaignTargetId,
                    reason,
                    escrowStatus: escrow.status,
                },
            },
        });

        let result;
        if (action === ResolveAction.RELEASE) {
            result = await this.escrowService.release(campaignTargetId, {
                actor: 'admin',
                correlationId: campaignTargetId,
            });
        } else if (action === ResolveAction.REFUND) {
            result = await this.escrowService.refund(campaignTargetId, {
                actor: 'admin',
                reason,
                correlationId: campaignTargetId,
            });
        } else {
            throw new BadRequestException('Invalid resolve action');
        }

        this.logger.warn(
            `[SYSTEM] Escrow ${action} executed for campaignTarget=${campaignTargetId}`,
        );

        return {
            ok: true,
            action,
            result,
        };
    }

    /**
     * =========================================================
     * ⏰ ESCROW WATCHDOG (AUTO REFUND)
     * =========================================================
     */
    async refundStuckEscrows() {
        const STUCK_HOURS = 6;

        const stuckEscrows = await this.prisma.escrow.findMany({
            where: {
                status: EscrowStatus.held,
                releasedAt: null,
                refundedAt: null,
                campaignTarget: {
                    postJob: {
                        OR: [
                            { status: PostJobStatus.failed },
                            {
                                executeAt: {
                                    lt: new Date(
                                        Date.now() -
                                        STUCK_HOURS * 60 * 60 * 1000,
                                    ),
                                },
                            },
                        ],
                    },
                },
            },
            include: {
                campaignTarget: {
                    include: { postJob: true },
                },
            },
            take: 50,
        });

        for (const escrow of stuckEscrows) {
            try {
                this.logger.warn(
                    `[WATCHDOG] Refunding stuck escrow ${escrow.id}`,
                );

                await this.escrowService.refund(
                    escrow.campaignTargetId,
                    {
                        actor: 'system',
                        reason: 'watchdog_stuck_escrow',
                        correlationId: escrow.campaignTargetId,
                    },
                );

                await this.prisma.userAuditLog.create({
                    data: {
                        userId: 'SYSTEM',
                        action: 'ESCROW_WATCHDOG_REFUND',
                        metadata: {
                            escrowId: escrow.id,
                            campaignTargetId: escrow.campaignTargetId,
                        },
                    },
                });
            } catch (err) {
                this.logger.error(
                    `[WATCHDOG] Failed refund escrow ${escrow.id}`,
                    err instanceof Error ? err.stack : String(err),
                );
            }
        }

        return { checked: stuckEscrows.length };
    }

    /**
     * =========================================================
     * 🔐 LEDGER INVARIANT CHECK
     * balance(wallet) === sum(ledger entries)
     * =========================================================
     */
    async checkLedgerInvariant() {
        this.logger.warn('[INVARIANT] Ledger check started');

        const wallets = await this.prisma.wallet.findMany({
            select: { id: true, balance: true },
        });

        for (const wallet of wallets) {
            const agg = await this.prisma.ledgerEntry.aggregate({
                where: { walletId: wallet.id },
                _sum: { amount: true },
            });

            const ledgerSum = new Decimal(agg._sum.amount ?? 0);
            const balance = new Decimal(wallet.balance);

            if (!ledgerSum.equals(balance)) {
                this.logger.error(
                    safeJsonStringify({
                        event: 'ledger_invariant_violation',
                        walletId: wallet.id,
                        balance: balance.toFixed(2),
                        ledger: ledgerSum.toFixed(2),
                    }),
                );

                // 🔥 PRODUCTION DECISION:
                // - crash
                // - alert
                // - page on-call
                throw new Error(
                    `Ledger invariant violated for wallet=${wallet.id}`,
                );
            }
        }

        this.logger.log('[INVARIANT] Ledger check passed');
    }

    async updateKillSwitch(params: {
        key: KillSwitchKey;
        enabled: boolean;
        reason?: string;
        actorUserId: string;
    }) {
        const { key, enabled, reason, actorUserId } = params;

        const result = await this.prisma.$transaction(async (tx) => {
            const killSwitch = await tx.killSwitch.upsert({
                where: { key },
                update: {
                    enabled,
                    reason,
                    updatedBy: actorUserId,
                },
                create: {
                    key,
                    enabled,
                    reason,
                    updatedBy: actorUserId,
                },
            });

            await tx.killSwitchEvent.create({
                data: {
                    key,
                    enabled,
                    reason,
                    updatedBy: actorUserId,
                    metadata: {
                        source: 'system_api',
                    },
                },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: actorUserId,
                    action: 'kill_switch_update',
                    metadata: {
                        key,
                        enabled,
                        reason,
                    },
                },
            });

            return killSwitch;
        });

        this.logger.warn(
            safeJsonStringify({
                event: 'kill_switch_update',
                key,
                enabled,
                reason: reason ?? null,
                actorUserId,
            }),
        );

        return result;
    }

    /**
     * =========================================================
     * 🧹 POST JOB STALL RECOVERY
     * =========================================================
     */
    async requeueStalledPostJobs() {
        const stalledMinutes = Number(
            process.env.POST_JOB_STALLED_MINUTES ?? 15,
        );
        const maxAttempts = Number(process.env.POST_JOB_MAX_ATTEMPTS ?? 3);
        const backoffMs = Number(process.env.POST_JOB_RETRY_BACKOFF_MS ?? 5000);
        const cutoff = new Date(Date.now() - stalledMinutes * 60 * 1000);

        const stalledJobs = await this.prisma.postJob.findMany({
            where: {
                status: PostJobStatus.sending,
                sendingAt: { lt: cutoff },
            },
            include: {
                executions: true,
            },
            take: 50,
        });

        for (const job of stalledJobs) {
            const hasExecution = job.executions.some(
                (execution) => execution.telegramMessageId,
            );

            try {
                if (hasExecution) {
                    await this.prisma.$transaction(async (tx) => {
                        assertPostJobTransition({
                            postJobId: job.id,
                            from: job.status,
                            to: PostJobStatus.success,
                            actor: 'system',
                            correlationId: job.id,
                        });

                        await tx.postJob.update({
                            where: { id: job.id },
                            data: {
                                status: PostJobStatus.success,
                                sendingAt: null,
                                telegramMessageId:
                                    job.executions.find(
                                        (execution) => execution.telegramMessageId,
                                    )?.telegramMessageId ?? null,
                            },
                        });

                        await this.escrowService.release(job.campaignTargetId, {
                            transaction: tx,
                            actor: 'system',
                            correlationId: job.id,
                        });
                    });
                    continue;
                }

                if (job.attempts >= maxAttempts) {
                    await this.prisma.$transaction(async (tx) => {
                        assertPostJobTransition({
                            postJobId: job.id,
                            from: job.status,
                            to: PostJobStatus.failed,
                            actor: 'system',
                            correlationId: job.id,
                        });

                        await tx.postJob.update({
                            where: { id: job.id },
                            data: {
                                status: PostJobStatus.failed,
                                sendingAt: null,
                                lastError: 'stalled_max_attempts',
                            },
                        });

                        await this.escrowService.refund(job.campaignTargetId, {
                            reason: 'stalled_max_attempts',
                            transaction: tx,
                            actor: 'system',
                            correlationId: job.id,
                        });
                    });
                    continue;
                }

                await this.prisma.postJob.update({
                    where: { id: job.id },
                    data: {
                        status: PostJobStatus.queued,
                        sendingAt: null,
                        executeAt: new Date(Date.now() + backoffMs),
                        lastError: 'stalled_requeued',
                    },
                });

                try {
                    await postQueue.add(
                        'execute-post',
                        { postJobId: job.id },
                        {
                            jobId: job.id,
                            delay: backoffMs,
                            attempts: maxAttempts,
                            backoff: {
                                type: 'exponential',
                                delay: backoffMs,
                            },
                            removeOnComplete: true,
                            removeOnFail: false,
                        },
                    );
                } catch (enqueueError) {
                    this.logger.warn(
                        safeJsonStringify({
                            event: 'post_job_requeue_skipped',
                            postJobId: job.id,
                            reason: 'already_queued',
                            error: enqueueError instanceof Error
                                ? enqueueError.message
                                : String(enqueueError),
                        }),
                    );
                }
            } catch (err) {
                this.logger.error(
                    safeJsonStringify({
                        event: 'post_job_requeue_failed',
                        postJobId: job.id,
                        error: err instanceof Error ? err.message : String(err),
                    }),
                );
            }
        }

        return { checked: stalledJobs.length };
    }

    async runRevenueReconciliation(params?: {
        mode?: ReconciliationMode;
        actorUserId?: string;
        correlationId?: string;
    }) {
        const mode = params?.mode ?? ReconciliationMode.DRY_RUN;
        const correlationId = params?.correlationId ?? `recon:${Date.now()}`;

        this.logger.warn(
            safeJsonStringify({
                event: 'reconciliation_requested',
                mode,
                actorUserId: params?.actorUserId ?? null,
                correlationId,
            }),
        );

        if (mode === ReconciliationMode.FIX && !params?.actorUserId) {
            throw new BadRequestException('Fix mode requires admin actor');
        }

        const discrepancies: Array<Record<string, unknown>> = [];

        const walletSum = await this.prisma.wallet.aggregate({
            _sum: { balance: true },
        });
        const ledgerSum = await this.prisma.ledgerEntry.aggregate({
            _sum: { amount: true },
        });

        const walletTotal = new Decimal(walletSum._sum.balance ?? 0);
        const ledgerTotal = new Decimal(ledgerSum._sum.amount ?? 0);

        if (!walletTotal.equals(ledgerTotal)) {
            const payload = {
                event: 'reconciliation_mismatch',
                check: 'wallet_vs_ledger',
                walletTotal: walletTotal.toFixed(2),
                ledgerTotal: ledgerTotal.toFixed(2),
                correlationId,
            };
            this.logger.error(safeJsonStringify(payload));
            discrepancies.push(payload);
        }

        const releasedEscrows = await this.prisma.escrow.aggregate({
            where: { status: EscrowStatus.released },
            _sum: { amount: true },
        });

        const payoutLedger = await this.prisma.ledgerEntry.aggregate({
            where: {
                reason: { in: [LedgerReason.payout, LedgerReason.commission] },
            },
            _sum: { amount: true },
        });

        const escrowTotal = new Decimal(releasedEscrows._sum.amount ?? 0);
        const payoutTotal = new Decimal(payoutLedger._sum.amount ?? 0);

        if (!escrowTotal.equals(payoutTotal)) {
            const payload = {
                event: 'reconciliation_mismatch',
                check: 'escrow_vs_payouts',
                escrowTotal: escrowTotal.toFixed(2),
                payoutTotal: payoutTotal.toFixed(2),
                correlationId,
            };
            this.logger.error(safeJsonStringify(payload));
            discrepancies.push(payload);
        }

        const SLA_HOURS = 6;
        const staleEscrows = await this.prisma.escrow.findMany({
            where: {
                status: EscrowStatus.held,
                createdAt: {
                    lt: new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000),
                },
            },
            select: {
                id: true,
                campaignTargetId: true,
                createdAt: true,
            },
            take: 100,
        });

        if (staleEscrows.length > 0) {
            const payload = {
                event: 'reconciliation_mismatch',
                check: 'stale_escrows',
                count: staleEscrows.length,
                escrows: staleEscrows,
                correlationId,
            };
            this.logger.error(safeJsonStringify(payload));
            discrepancies.push(payload);
        }

        const postedWithoutRelease = await this.prisma.campaignTarget.findMany({
            where: {
                status: CampaignTargetStatus.posted,
                OR: [
                    { escrow: { is: null } },
                    {
                        escrow: {
                            is: {
                                status: { not: EscrowStatus.released },
                            },
                        },
                    },
                ],
            },
            select: {
                id: true,
                campaignId: true,
                status: true,
                escrow: {
                    select: { status: true },
                },
            },
            take: 100,
        });

        if (postedWithoutRelease.length > 0) {
            const payload = {
                event: 'reconciliation_mismatch',
                check: 'posted_without_release',
                count: postedWithoutRelease.length,
                targets: postedWithoutRelease,
                correlationId,
            };
            this.logger.error(safeJsonStringify(payload));
            discrepancies.push(payload);
        }

        if (mode === ReconciliationMode.FIX) {
            this.logger.warn(
                safeJsonStringify({
                    event: 'reconciliation_fix_requested',
                    correlationId,
                    actorUserId: params?.actorUserId ?? null,
                    discrepancies: discrepancies.length,
                }),
            );

            const jsonDiscrepancies: Prisma.InputJsonArray = discrepancies.map(
                (entry) => toJsonValue(entry),
            );

            await this.prisma.userAuditLog.create({
                data: {
                    userId: params!.actorUserId!,
                    action: 'reconciliation_fix_requested',
                    metadata: {
                        correlationId,
                        discrepancies: jsonDiscrepancies,
                        note: 'No automatic fixes applied',
                    },
                },
            });
        }

        return {
            ok: discrepancies.length === 0,
            mode,
            correlationId,
            discrepancies,
            readOnly: mode === ReconciliationMode.DRY_RUN,
        };
    }
}
