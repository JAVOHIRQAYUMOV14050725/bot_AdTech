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
import { ConfigService, ConfigType } from '@nestjs/config';
import appConfig from '@/config/app.config';
import {
    CampaignTargetStatus,
    EscrowStatus,
    KillSwitchKey,
    LedgerReason,
    PostJobStatus,
    Prisma,
} from '@prisma/client';
import { ReconciliationMode } from './dto/reconciliation.dto';
import { getPostQueue } from '@/modules/scheduler/queues';
import redisConfig from '@/config/redis.config';
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

    constructor(
        private readonly prisma: PrismaService,
        private readonly escrowService: EscrowService,
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,

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
        const correlationId = campaignTargetId;
        let escrowId: string | null = null;
        let escrowStatus: EscrowStatus | null = null;

        try {
            const { escrow, result } = await this.prisma.$transaction(
                async (tx) => {
                    const escrowRow = await tx.escrow.findUnique({
                        where: { campaignTargetId },
                    });

                    if (!escrowRow) {
                        throw new BadRequestException('Escrow not found');
                    }

                    if (escrowRow.status !== EscrowStatus.held) {
                        throw new BadRequestException(
                            `Escrow already ${escrowRow.status}`,
                        );
                    }

                    escrowId = escrowRow.id;
                    escrowStatus = escrowRow.status;

                    await tx.userAuditLog.create({
                        data: {
                            userId: actorUserId,
                            action: `ESCROW_${action.toUpperCase()}_ATTEMPT`,
                            metadata: {
                                campaignTargetId,
                                reason,
                                escrowStatus: escrowRow.status,
                            },
                        },
                    });

                    try {
                        let resolutionResult;
                        if (action === ResolveAction.RELEASE) {
                            resolutionResult = await this.escrowService.release(
                                campaignTargetId,
                                {
                                    actor: 'admin',
                                    correlationId,
                                    transaction: tx,
                                },
                            );
                        } else if (action === ResolveAction.REFUND) {
                            resolutionResult = await this.escrowService.refund(
                                campaignTargetId,
                                {
                                    actor: 'admin',
                                    reason,
                                    correlationId,
                                    transaction: tx,
                                },
                            );
                        } else {
                            throw new BadRequestException(
                                'Invalid resolve action',
                            );
                        }

                        await tx.userAuditLog.create({
                            data: {
                                userId: actorUserId,
                                action: `ESCROW_${action.toUpperCase()}_SUCCESS`,
                                metadata: {
                                    campaignTargetId,
                                    reason,
                                    escrowStatus: escrowRow.status,
                                },
                            },
                        });

                        return { escrow: escrowRow, result: resolutionResult };
                    } catch (err) {
                        await tx.userAuditLog.create({
                            data: {
                                userId: actorUserId,
                                action: `ESCROW_${action.toUpperCase()}_FAILED`,
                                metadata: {
                                    campaignTargetId,
                                    reason,
                                    escrowStatus: escrowRow.status,
                                    error: err instanceof Error ? err.message : String(err),
                                },
                            },
                        });
                        throw err;
                    }
                },
            );

            this.logger.warn(
                {
                    event: 'escrow_manual_resolve',
                    alert: false,
                    entityType: 'escrow',
                    entityId: escrow.id,
                    actorId: actorUserId,
                    data: {
                        campaignTargetId,
                        action,
                        reason,
                        escrowStatus: escrow.status,
                    },
                    correlationId,
                },
                'SystemService',
            );

            return {
                ok: true,
                action,
                result,
            };
        } catch (err) {
            this.logger.error(
                {
                    event: 'escrow_manual_resolve_failed',
                    alert: true,
                    entityType: 'escrow',
                    entityId: escrowId,
                    actorId: actorUserId,
                    data: {
                        campaignTargetId,
                        action,
                        reason,
                        escrowStatus,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    correlationId,
                },
                err instanceof Error ? err.stack : undefined,
                'SystemService',
            );
            throw err;
        }
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
        const app = this.configService.getOrThrow<ConfigType<typeof appConfig>>(
            appConfig.KEY,
            { infer: true },
        );
        const stalledMinutes = app.postJob.stalledMinutes;
        const maxAttempts = app.postJob.maxAttempts;
        const backoffMs = app.postJob.retryBackoffMs;
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
                    const redis = this.configService.getOrThrow<ConfigType<typeof redisConfig>>(
                        redisConfig.KEY,
                        { infer: true },
                    );
                    await getPostQueue(redis).add(
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
                        {
                            event: 'post_job_requeue_enqueue_failed',
                            postJobId: job.id,
                            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
                        },
                        'SystemService',
                    );
                }
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