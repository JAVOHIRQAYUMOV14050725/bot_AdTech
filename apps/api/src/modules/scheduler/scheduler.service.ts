import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemService } from '@/modules/system/system.service';
import { postQueue } from './queues';

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(private readonly systemService: SystemService) { }

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
        this.logger.warn('[CRON] Ledger invariant check');
        await this.systemService.checkLedgerInvariant();
    }
}