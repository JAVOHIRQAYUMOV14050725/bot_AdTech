import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemService } from '@/modules/system/system.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { CronStatusService } from './cron-status.service';
import { runWithCronContext } from '@/common/context/request-context';

@Injectable()
export class SchedulerService {
    constructor(
        private readonly systemService: SystemService,
        private readonly killSwitchService: KillSwitchService,
        private readonly cronStatusService: CronStatusService,
        private readonly outboxService: OutboxService,
        @Inject('LOGGER') private readonly logger: LoggerService,

    ) { }

    /**
     * =========================================================
     * 📤 OUTBOX DISPATCHER
     * =========================================================
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async outboxDispatcher() {
        return runWithCronContext('outbox_dispatch', async () => {
            try {
                await this.outboxService.processPending();
                await this.cronStatusService.recordRun({
                    name: 'outbox_dispatch',
                    result: 'success',
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await this.cronStatusService.recordRun({
                    name: 'outbox_dispatch',
                    result: 'failed',
                    error: message,
                });
                this.logger.error(
                    {
                        event: 'outbox_dispatch_failed',
                        error: message,
                    },
                    'SchedulerService',
                );
                throw err;
            }
        });
    }

    /**
     * =========================================================
     * ⏰ ESCROW WATCHDOG
     * =========================================================
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async escrowWatchdog() {
        return runWithCronContext('escrow_watchdog', async () => {
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

            this.logger.warn(
                {
                    event: 'escrow_watchdog_triggered',
                    enabled,
                },
                'SchedulerService',
            );
            try {
                await this.systemService.refundStuckEscrows();
                await this.cronStatusService.recordRun({
                    name: 'escrow_watchdog',
                    result: 'success',
                });
                this.logger.log(
                    {
                        event: 'escrow_watchdog_completed',
                        enabled,
                    },
                    'SchedulerService',
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await this.cronStatusService.recordRun({
                    name: 'escrow_watchdog',
                    result: 'failed',
                    error: message,
                });
                this.logger.error(
                    {
                        event: 'escrow_watchdog_failed',
                        error: message,
                        enabled,
                    },
                    'SchedulerService',
                );
                throw err;
            }
        });
    }

    /**
     * =========================================================
     * 🔐 LEDGER INVARIANT WATCHDOG
     * =========================================================
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async ledgerInvariantWatchdog() {
        return runWithCronContext('ledger_invariant', async () => {
            const enabled = await this.killSwitchService.isEnabled('worker_watchdogs');
            if (!enabled) {
                this.logger.warn(
                    {
                        event: 'ledger_invariant_watchdog_paused',
                        reason: 'kill_switch_disabled',
                        enabled,
                    },
                    'SchedulerService',
                );
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
                this.logger.log(
                    {
                        event: 'ledger_invariant_check_completed',
                        enabled,
                    },
                    'SchedulerService',
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await this.cronStatusService.recordRun({
                    name: 'ledger_invariant',
                    result: 'failed',
                    error: message,
                });
                this.logger.error(
                    {
                        event: 'ledger_invariant_check_failed',
                        error: message,
                        enabled,
                    },
                    'SchedulerService',
                );
                throw err;
            }
        });
    }

    /**
     * =========================================================
     * 🧯 STALLED POST JOB RECOVERY
     * =========================================================
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async postJobRecovery() {
        return runWithCronContext('post_job_recovery', async () => {
            const enabled = await this.killSwitchService.isEnabled('worker_watchdogs');
            if (!enabled) {
                this.logger.warn(
                    {
                        event: 'post_job_recovery_paused',
                        reason: 'kill_switch_disabled',
                        enabled,
                    },
                    'SchedulerService',
                );
                await this.cronStatusService.recordRun({
                    name: 'post_job_recovery',
                    result: 'skipped',
                    error: 'kill_switch_disabled',
                });
                return;
            }

            this.logger.warn(
                {
                    event: 'post_job_recovery_triggered',
                    enabled,
                },
                'SchedulerService',
            );
            try {
                const schemaCheck = await this.systemService.checkPostJobSchema();
                if (!schemaCheck.ok) {
                    const error = `missing_columns:${schemaCheck.missingColumns.join(',')}`;
                    this.logger.warn(
                        {
                            event: 'post_job_recovery_skipped',
                            reason: 'schema_invariant_failed',
                            missingColumns: schemaCheck.missingColumns,
                            enabled,
                        },
                        'SchedulerService',
                    );
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
                this.logger.log(
                    {
                        event: 'post_job_recovery_completed',
                        enabled,
                    },
                    'SchedulerService',
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await this.cronStatusService.recordRun({
                    name: 'post_job_recovery',
                    result: 'failed',
                    error: message,
                });
                this.logger.error(
                    {
                        event: 'post_job_recovery_failed',
                        error: message,
                        enabled,
                    },
                    'SchedulerService',
                );
            }
        });
    }

    /**
     * =========================================================
     * 🧾 REVENUE RECONCILIATION (READ-ONLY)
     * =========================================================
     */
    @Cron(CronExpression.EVERY_HOUR)
    async revenueReconciliation() {
        return runWithCronContext('revenue_reconciliation', async () => {
            const enabled = await this.killSwitchService.isEnabled(
                'worker_reconciliation',
            );
            if (!enabled) {
                this.logger.warn(
                    {
                        event: 'revenue_reconciliation_paused',
                        reason: 'kill_switch_disabled',
                        enabled,
                    },
                    'SchedulerService',
                );
                await this.cronStatusService.recordRun({
                    name: 'revenue_reconciliation',
                    result: 'skipped',
                    error: 'kill_switch_disabled',
                });
                return;
            }

            this.logger.warn(
                {
                    event: 'revenue_reconciliation_triggered',
                    enabled,
                },
                'SchedulerService',
            );
            try {
                await this.systemService.runRevenueReconciliation();
                await this.cronStatusService.recordRun({
                    name: 'revenue_reconciliation',
                    result: 'success',
                });
                this.logger.log(
                    {
                        event: 'revenue_reconciliation_completed',
                        enabled,
                    },
                    'SchedulerService',
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await this.cronStatusService.recordRun({
                    name: 'revenue_reconciliation',
                    result: 'failed',
                    error: message,
                });
                this.logger.error(
                    {
                        event: 'revenue_reconciliation_failed',
                        error: message,
                        enabled,
                    },
                    'SchedulerService',
                );
                throw err;
            }
        });
    }
}
