import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemService } from '@/modules/system/system.service';
import { postQueue } from './queues';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly systemService: SystemService,
        private readonly killSwitchService: KillSwitchService,
    ) { }

    /**
     * =========================================================
     * 📬 POST EXECUTION QUEUE (EVENT-DRIVEN)
     * =========================================================
     */
    async enqueuePost(postJobId: string, executeAt: Date) {
        await postQueue.add(
            'execute-post',
            { postJobId },
            {
                jobId: postJobId,
                delay: Math.max(executeAt.getTime() - Date.now(), 0),
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
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
            return;
        }

        this.logger.warn('[CRON] Escrow watchdog triggered');
        await this.systemService.refundStuckEscrows();
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
            return;
        }

        this.logger.warn('[CRON] Ledger invariant check');
        await this.systemService.checkLedgerInvariant();
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
            return;
        }

        this.logger.warn('[CRON] Revenue reconciliation triggered');
        await this.systemService.runRevenueReconciliation();
    }
}