import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { EnvVars } from '@/config/env.schema';
import { buildRedisConnection } from '@/config/redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor(private readonly configService: ConfigService<EnvVars>) {
        this.client = new Redis(buildRedisConnection(this.configService));
    }

    getClient(): Redis {
        return this.client;
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}
