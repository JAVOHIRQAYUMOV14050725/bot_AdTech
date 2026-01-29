import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { EnvVars } from '@/config/env.schema';
import { buildRedisConnection } from '@/config/redis.config';

@Injectable()
export class SchedulerQueuesService {
    readonly postQueue: Queue;
    readonly postDlq: Queue;
    readonly channelVerifyQueue: Queue;
    readonly channelVerifyDlq: Queue;
    private readonly connection: ReturnType<typeof buildRedisConnection>;

    constructor(private readonly configService: ConfigService<EnvVars>) {
        this.connection = buildRedisConnection(this.configService);
        this.postQueue = new Queue('post-queue', { connection: this.connection });
        this.postDlq = new Queue('post-queue-dlq', { connection: this.connection });
        this.channelVerifyQueue = new Queue('channel-verify-queue', {
            connection: this.connection,
        });
        this.channelVerifyDlq = new Queue('channel-verify-queue-dlq', {
            connection: this.connection,
        });
    }

    getConnection() {
        return this.connection;
    }
}
