import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnection } from '@/modules/scheduler/queues';

@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly client: Redis;

    constructor() {
        this.client = new Redis({
            ...redisConnection,
            password: process.env.REDIS_PASSWORD,
        });
    }

    getClient(): Redis {
        return this.client;
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}