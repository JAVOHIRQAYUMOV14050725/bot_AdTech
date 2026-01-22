import { Queue } from 'bullmq';

export const redisConnection = {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000),
};

export const postQueue = new Queue('post-queue', {
    connection: redisConnection,
});

export const postDlq = new Queue('post-queue-dlq', {
    connection: redisConnection,
});
