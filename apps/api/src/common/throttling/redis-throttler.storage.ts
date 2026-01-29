import { Injectable } from '@nestjs/common';
import type {
    ThrottlerStorage,
} from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
    constructor(private readonly redis: Redis) { }

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): Promise<ThrottlerStorageRecord> {
        const hitsKey = `th:${throttlerName}:${key}`;
        const blockKey = `thb:${throttlerName}:${key}`;

        // 1) blocked?
        const blockTtl = await this.redis.ttl(blockKey);
        if (blockTtl > 0) {
            return {
                totalHits: limit,
                timeToExpire: ttl,
                isBlocked: true,
                timeToBlockExpire: blockTtl,
            };
        }

        // 2) increment hits
        const multi = this.redis.multi();
        multi.incr(hitsKey);
        multi.ttl(hitsKey);
        const res = await multi.exec();

        const totalHits = Number(res?.[0]?.[1] ?? 0);
        let timeToExpire = Number(res?.[1]?.[1] ?? -1);

        if (timeToExpire < 0) {
            await this.redis.expire(hitsKey, ttl);
            timeToExpire = ttl;
        }

        // 3) if exceed limit => block
        if (totalHits > limit) {
            // set block key with TTL = blockDuration
            await this.redis.set(blockKey, '1', 'EX', blockDuration);

            return {
                totalHits,
                timeToExpire,
                isBlocked: true,
                timeToBlockExpire: blockDuration,
            };
        }

        return {
            totalHits,
            timeToExpire,
            isBlocked: false,
            timeToBlockExpire: 0,
        };
    }
}
