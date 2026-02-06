import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';

@Injectable()
export class TelegramUserLockService {
    private readonly logger = new Logger(TelegramUserLockService.name);
    private readonly ttlMs = 15_000;

    constructor(private readonly redis: RedisService) { }

    private key(userId: number) {
        return `tg:lock:${userId}`;
    }

    async tryAcquire(userId: number): Promise<boolean> {
        const result = await this.redis.getClient().set(this.key(userId), '1', 'PX', this.ttlMs, 'NX');
        return result === 'OK';
    }

    async release(userId: number): Promise<void> {
        try {
            await this.redis.getClient().del(this.key(userId));
        } catch (err) {
            this.logger.error({
                event: 'telegram_lock_release_failed',
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
