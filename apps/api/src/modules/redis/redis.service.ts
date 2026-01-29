import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { ConfigService, ConfigType } from '@nestjs/config';
import redisConfig from '@/config/redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private readonly configService: ConfigService) {
        const cfg = this.configService.getOrThrow<ConfigType<typeof redisConfig>>(
            redisConfig.KEY,
            { infer: true },
        );

        const options: RedisOptions = {
            host: cfg.host,
            port: cfg.port,
            password: cfg.password || undefined,
            db: cfg.db ?? 0,
            enableReadyCheck: true,
            maxRetriesPerRequest: null,
        };

        this.client = new Redis(options);
    }

    getClient(): Redis {
        return this.client;
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}
