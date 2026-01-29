import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService, ConfigType } from '@nestjs/config';
import redisConfig from '@/config/redis.config';
import { buildRedisConnection } from '@/modules/scheduler/queues';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private readonly configService: ConfigService) {
        const redis = this.configService.getOrThrow<ConfigType<typeof redisConfig>>(
            redisConfig.KEY,
            { infer: true },
        );
        this.client = new Redis(buildRedisConnection(redis));
    }

    getClient(): Redis {
        return this.client;
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}
