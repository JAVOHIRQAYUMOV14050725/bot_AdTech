import { PrismaService } from '@/prisma/prisma.service';
import {
    BadRequestException,
    Inject,
    Injectable,
    LoggerService,
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
import { OutboxService } from '@/modules/outbox/outbox.service';
import { assertPostJobTransition } from '@/modules/lifecycle/lifecycle';
import { WorkerConfig, workerConfig } from '@/config/worker.config';

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

    constructor(
        private readonly prisma: PrismaService,
        private readonly escrowService: EscrowService,
        private readonly outboxService: OutboxService,
        @Inject('LOGGER') private readonly logger: LoggerService,
        @Inject(workerConfig.KEY)
        private readonly workerConfig: WorkerConfig,

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
        const resolved = await this.prisma.$transaction(async (tx) => {
            const escrow = await tx.escrow.findUnique({
                where: { campaignTargetId },
            });

            if (!escrow) {
                throw new BadRequestException('Escrow not found');
            }

            if (escrow.status !== EscrowStatus.held) {
                throw new BadRequestException(`Escrow already ${escrow.status}`);
            }

            await tx.userAuditLog.create({
                data: {
                    userId: actorUserId,
                    action: `ESCROW_${action.toUpperCase()}_ATTEMPT`,
                    metadata: {
                        campaignTargetId,
                        reason,
                        escrowStatus: escrow.status,
                    },
                },
            });

            try {
                let result;
                if (action === ResolveAction.RELEASE) {
                    result = await this.escrowService.release(campaignTargetId, {
                        actor: 'admin',
                        correlationId: campaignTargetId,
                        transaction: tx,
                    });
                } else if (action === ResolveAction.REFUND) {
                    result = await this.escrowService.refund(campaignTargetId, {
                        actor: 'admin',
                        reason,
                        correlationId: campaignTargetId,
                        transaction: tx,
                    });
                } else {
                    throw new BadRequestException('Invalid resolve action');
                }

                await tx.userAuditLog.create({
                    data: {
                        userId: actorUserId,
                        action: `ESCROW_${action.toUpperCase()}_RESULT`,
                        metadata: {
                            campaignTargetId,
                            reason,
                            escrowStatus: escrow.status,
                            result: toJsonValue(result),
                        },
                    },
                });

                return {
                    escrowId: escrow.id,
                    escrowStatus: escrow.status,
                    result,
                };
            } catch (err) {
                await tx.userAuditLog.create({
                    data: {
                        userId: actorUserId,
                        action: `ESCROW_${action.toUpperCase()}_FAILED`,
                        metadata: {
                            campaignTargetId,
                            reason,
                            escrowStatus: escrow.status,
                            error: toJsonValue({
                                message: err instanceof Error ? err.message : String(err),
                                name: err instanceof Error ? err.name : 'UnknownError',
                            }),
                        },
                    },
                });
                throw err;
            }
        });

        this.logger.warn(
            {
                event: 'escrow_manual_resolve',
                entityType: 'escrow',
                entityId: resolved.escrowId,
                actorId: actorUserId,
                data: {
                    campaignTargetId,
                    action,
                    reason,
                    escrowStatus: resolved.escrowStatus,
                },
                correlationId: campaignTargetId,
            },
            'SystemService',
        );

        return {
            ok: true,
            action,
            result: resolved.result,
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
                this.logger.warn({
                    event: 'escrow_watchdog_refund_attempt',
                    escrowId: escrow.id,
                    campaignTargetId: escrow.campaignTargetId,
                    postJobStatus: escrow.campaignTarget.postJob?.status,
                }
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
                this.logger.error({
                    event: 'escrow_watchdog_refund_failed',
                    escrowId: escrow.id,
                    campaignTargetId: escrow.campaignTargetId,
                    error: err instanceof Error ? err.message : String(err),

                },
                    'SystemService',
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
        this.logger.warn({
            event: 'ledger_invariant_check_start',
        },
            'SystemService',);

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
                this.logger.error({
                    event: 'ledger_invariant_violated',
                    entityType: 'wallet',
                    entityId: wallet.id,
                    data: {
                        walletBalance: balance.toString(),
                        ledgerSum: ledgerSum.toString(),
                    }
                },
                    'SystemService',
                )

                // 🔥 PRODUCTION DECISION:
                // - crash
                // - alert
                // - page on-call
                throw new Error(
                    `Ledger invariant violated for wallet=${wallet.id}`,
                );
            }
        }

        this.logger.log({
            event: 'ledger_invariant_check_complete',

        },
            'SystemService',
        );
    }

    async getDbConnections() {
        const rows = await this.prisma.$queryRaw<
            { state: string | null; count: number }[]
        >(Prisma.sql`
            SELECT state, COUNT(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY state
        `);

        const total = rows.reduce((sum, row) => sum + row.count, 0);

        return {
            total,
            byState: rows.map((row) => ({
                state: row.state ?? 'unknown',
                count: row.count,
            })),
            generatedAt: new Date().toISOString(),
        };
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

        this.logger.warn({
            event: 'kill_switch_updated',
            entityType: 'kill_switch',
            entityId: result.key,
            actorId: actorUserId,
            data: {
                enabled: result.enabled,
            }
        },
            'SystemService',
        );

        return result;
    }

    /**
     * =========================================================
     * 🧹 POST JOB STALL RECOVERY
     * =========================================================
     */
    async checkPostJobSchema() {
        const result = await this.prisma.$queryRaw<{ column_name: string }[]>(
            Prisma.sql`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'post_jobs';
            `,
        );

        const columns = new Set(result.map((row) => row.column_name));
        const requiredColumns = ['sendingAt', 'lastAttemptAt', 'telegramMessageId'];
        const missingColumns = requiredColumns.filter(
            (column) => !columns.has(column),
        );

        return {
            ok: missingColumns.length === 0,
            missingColumns,
        };
    }

    async requeueStalledPostJobs() {
        const stalledMinutes = this.workerConfig.postJobStalledMinutes;
        const maxAttempts = this.workerConfig.postJobMaxAttempts;
        const backoffMs = this.workerConfig.postJobRetryBackoffMs;
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

                const nextExecuteAt = new Date(Date.now() + backoffMs);
                await this.prisma.$transaction(async (tx) => {
                    await tx.postJob.update({
                        where: { id: job.id },
                        data: {
                            status: PostJobStatus.queued,
                            sendingAt: null,
                            executeAt: nextExecuteAt,
                            lastError: 'stalled_requeued',
                        },
                    });

                    await this.outboxService.enqueuePostJob(
                        tx,
                        job.id,
                        nextExecuteAt,
                    );
                });
            } catch (err) {
                this.logger.error({
                    event: 'post_job_requeue_failed',
                    postJobId: job.id,
                    error: err instanceof Error ? err.message : String(err),
                },
                    'SystemService',
                )
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

        this.logger.warn({
            event: 'revenue_reconciliation_start',
            mode,
            correlationId,
        },
            'SystemService',
        )

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
            this.logger.error({
                event: 'reconciliation_mismatch',
                check: 'wallet_vs_ledger',
                walletTotal: walletTotal.toFixed(2),
                ledgerTotal: ledgerTotal.toFixed(2),
                correlationId,
            },
                'SystemService',
            );
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
            this.logger.error({
                event: 'reconciliation_mismatch',
                check: 'escrow_vs_payouts',
                escrowTotal: escrowTotal.toFixed(2),
                payoutTotal: payoutTotal.toFixed(2),
                correlationId,
            },
                'SystemService',
            );
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
            this.logger.error({
                event: 'reconciliation_mismatch',
                check: 'stale_escrows',
                count: staleEscrows.length,
                escrows: staleEscrows,
                correlationId,
            },
                'SystemService',
            );
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
            this.logger.error({
                event: 'reconciliation_mismatch',
                check: 'posted_without_release',
                count: postedWithoutRelease.length,
                targets: postedWithoutRelease,
                correlationId,
            },
            );
            discrepancies.push(payload);
        }

        if (mode === ReconciliationMode.FIX) {
            this.logger.warn({
                event: 'revenue_reconciliation_fix_start',
                correlationId,
                discrepanciesCount: discrepancies.length,
            },
                'SystemService',
            )

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
