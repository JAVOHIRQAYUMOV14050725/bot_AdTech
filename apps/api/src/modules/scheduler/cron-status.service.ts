import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';

export type CronResult = 'success' | 'failed' | 'skipped';

export interface CronStatus {
    name: string;
    lastRunAt: string;
    lastResult: CronResult;
    lastError?: string | null;
}

@Injectable()
export class CronStatusService {
    private readonly logger = new Logger(CronStatusService.name);
    private readonly fallback = new Map<string, CronStatus>();

    constructor(private readonly redisService: RedisService) { }

    private key(name: string) {
        return `cron:status:${name}`;
    }

    async recordRun(params: {
        name: string;
        result: CronResult;
        error?: string;
    }) {
        const lastRunAt = new Date().toISOString();
        const payload = {
            name: params.name,
            lastRunAt,
            lastResult: params.result,
            lastError: params.error ?? null,
        };

        try {
            const client = this.redisService.getClient();
            await client.hset(this.key(params.name), payload);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.logger.error(
                `[CRON] Failed to record status for ${params.name}`,
                err instanceof Error ? err.stack : String(err),
            );
            this.fallback.set(params.name, {
                name: params.name,
                lastRunAt,
                lastResult: 'failed',
                lastError: `cron_status_write_failed:${errorMessage}`,
            });
        }
    }

    async getStatus(name: string): Promise<CronStatus | null> {
        try {
            const client = this.redisService.getClient();
            const data = await client.hgetall(this.key(name));
            if (!data || Object.keys(data).length === 0) {
                return this.fallback.get(name) ?? null;
            }

            return {
                name,
                lastRunAt: data.lastRunAt,
                lastResult: data.lastResult as CronResult,
                lastError: data.lastError ?? null,
            };
        } catch (err) {
            this.logger.error(
                `[CRON] Failed to read status for ${name}`,
                err instanceof Error ? err.stack : String(err),
            );
            return this.fallback.get(name) ?? null;
        }
    }
}
