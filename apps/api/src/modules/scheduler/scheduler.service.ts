import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemService } from '@/modules/system/system.service';
import { postQueue } from './queues';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { CronStatusService } from './cron-status.service';

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly systemService: SystemService,
        private readonly killSwitchService: KillSwitchService,
        private readonly cronStatusService: CronStatusService,
    ) { }

    /**
     * =========================================================
     * 📬 POST EXECUTION QUEUE (EVENT-DRIVEN)
     * =========================================================
     */
    async enqueuePost(postJobId: string, executeAt: Date) {
        const maxAttempts = Number(process.env.POST_JOB_MAX_ATTEMPTS ?? 3);
        const backoffMs = Number(process.env.POST_JOB_RETRY_BACKOFF_MS ?? 5000);
        await postQueue.add(
            'execute-post',
            { postJobId },
            {
                jobId: postJobId,
                delay: Math.max(executeAt.getTime() - Date.now(), 0),
                attempts: maxAttempts,
                backoff: {
                    type: 'exponential',
                    delay: backoffMs,
                },
                removeOnComplete: true,
                removeOnFail: false,
            },
        );
    }

    /**
     * =========================================================
     * ⏰ ESCROW WATCHDOG
     * =========================================================
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async escrowWatchdog() {
        const enabled = await this.killSwitchService.isEnabled('worker_watchdogs');
        if (!enabled) {
            this.logger.warn('[CRON] Escrow watchdog paused by kill switch');
            await this.cronStatusService.recordRun({
                name: 'escrow_watchdog',
                result: 'skipped',
                error: 'kill_switch_disabled',
            });
            return;
        }

        this.logger.warn('[CRON] Escrow watchdog triggered');
        try {
            await this.systemService.refundStuckEscrows();
            await this.cronStatusService.recordRun({
                name: 'escrow_watchdog',
                result: 'success',
            });
            this.logger.log('[CRON] Escrow watchdog completed');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.cronStatusService.recordRun({
                name: 'escrow_watchdog',
                result: 'failed',
                error: message,
            });
            this.logger.error('[CRON] Escrow watchdog failed', message);
            throw err;
        }
    }

    /**
     * =========================================================
     * 🔐 LEDGER INVARIANT WATCHDOG
     * =========================================================
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async ledgerInvariantWatchdog() {
        const enabled = await this.killSwitchService.isEnabled('worker_watchdogs');
        if (!enabled) {
            this.logger.warn('[CRON] Ledger watchdog paused by kill switch');
            await this.cronStatusService.recordRun({
                name: 'ledger_invariant',
                result: 'skipped',
                error: 'kill_switch_disabled',
            });
            return;
        }

        this.logger.warn('[CRON] Ledger invariant check');
        try {
            await this.systemService.checkLedgerInvariant();
            await this.cronStatusService.recordRun({
                name: 'ledger_invariant',
                result: 'success',
            });
            this.logger.log('[CRON] Ledger invariant completed');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.cronStatusService.recordRun({
                name: 'ledger_invariant',
                result: 'failed',
                error: message,
            });
            this.logger.error('[CRON] Ledger invariant failed', message);
            throw err;
        }
    }

    /**
     * =========================================================
     * 🧯 STALLED POST JOB RECOVERY
     * =========================================================
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async postJobRecovery() {
        const enabled = await this.killSwitchService.isEnabled('worker_watchdogs');
        if (!enabled) {
            this.logger.warn('[CRON] Post job recovery paused by kill switch');
            await this.cronStatusService.recordRun({
                name: 'post_job_recovery',
                result: 'skipped',
                error: 'kill_switch_disabled',
            });
            return;
        }

        this.logger.warn('[CRON] Post job recovery triggered');
        try {
            const schemaCheck = await this.systemService.checkPostJobSchema();
            if (!schemaCheck.ok) {
                const error = `missing_columns:${schemaCheck.missingColumns.join(',')}`;
                this.logger.warn(`[CRON] Post job recovery skipped: ${error}`);
                await this.cronStatusService.recordRun({
                    name: 'post_job_recovery',
                    result: 'skipped',
                    error,
                });
                return;
            }

            await this.systemService.requeueStalledPostJobs();
            await this.cronStatusService.recordRun({
                name: 'post_job_recovery',
                result: 'success',
            });
            this.logger.log('[CRON] Post job recovery completed');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.cronStatusService.recordRun({
                name: 'post_job_recovery',
                result: 'failed',
                error: message,
            });
            this.logger.error('[CRON] Post job recovery failed', message);
        }
    }

    /**
     * =========================================================
     * 🧾 REVENUE RECONCILIATION (READ-ONLY)
     * =========================================================
     */
    @Cron(CronExpression.EVERY_HOUR)
    async revenueReconciliation() {
        const enabled = await this.killSwitchService.isEnabled(
            'worker_reconciliation',
        );
        if (!enabled) {
            this.logger.warn('[CRON] Reconciliation paused by kill switch');
            await this.cronStatusService.recordRun({
                name: 'revenue_reconciliation',
                result: 'skipped',
                error: 'kill_switch_disabled',
            });
            return;
        }

        this.logger.warn('[CRON] Revenue reconciliation triggered');
        try {
            await this.systemService.runRevenueReconciliation();
            await this.cronStatusService.recordRun({
                name: 'revenue_reconciliation',
                result: 'success',
            });
            this.logger.log('[CRON] Revenue reconciliation completed');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.cronStatusService.recordRun({
                name: 'revenue_reconciliation',
                result: 'failed',
                error: message,
            });
            this.logger.error('[CRON] Revenue reconciliation failed', message);
            throw err;
        }
    }
}
