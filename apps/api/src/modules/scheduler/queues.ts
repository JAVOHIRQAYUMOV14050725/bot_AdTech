import { Queue } from 'bullmq';
import { loadEnv } from '@/config/env';

const env = loadEnv();

export const redisConnection = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD ?? undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000),
};

export const postQueue = new Queue('post-queue', { connection: redisConnection });
export const postDlq = new Queue('post-queue-dlq', { connection: redisConnection });

// ✅ NEW
export const channelVerifyQueue = new Queue('channel-verify-queue', {
    connection: redisConnection,
});

export const channelVerifyDlq = new Queue('channel-verify-queue-dlq', {
    connection: redisConnection,
});
