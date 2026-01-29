import { Queue, QueueOptions } from 'bullmq';
import { ConfigType } from '@nestjs/config';
import redisConfig from '@/config/redis.config';

type RedisConnection = NonNullable<QueueOptions['connection']>;

let cachedConnection: RedisConnection | null = null;
let postQueueInstance: Queue | null = null;
let postDlqInstance: Queue | null = null;
let channelVerifyQueueInstance: Queue | null = null;
let channelVerifyDlqInstance: Queue | null = null;

export const buildRedisConnection = (
    redis: ConfigType<typeof redisConfig>,
): RedisConnection => ({
    host: redis.host,
    port: redis.port,
    password: redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000),
});

export const getRedisConnection = (
    redis: ConfigType<typeof redisConfig>,
): RedisConnection => {
    if (!cachedConnection) {
        cachedConnection = buildRedisConnection(redis);
    }
    return cachedConnection;
};

export const getPostQueue = (redis: ConfigType<typeof redisConfig>) => {
    if (!postQueueInstance) {
        postQueueInstance = new Queue('post-queue', {
            connection: getRedisConnection(redis),
        });
    }
    return postQueueInstance;
};

export const getPostDlq = (redis: ConfigType<typeof redisConfig>) => {
    if (!postDlqInstance) {
        postDlqInstance = new Queue('post-queue-dlq', {
            connection: getRedisConnection(redis),
        });
    }
    return postDlqInstance;
};

export const getChannelVerifyQueue = (
    redis: ConfigType<typeof redisConfig>,
) => {
    if (!channelVerifyQueueInstance) {
        channelVerifyQueueInstance = new Queue('channel-verify-queue', {
            connection: getRedisConnection(redis),
        });
    }
    return channelVerifyQueueInstance;
};

export const getChannelVerifyDlq = (
    redis: ConfigType<typeof redisConfig>,
) => {
    if (!channelVerifyDlqInstance) {
        channelVerifyDlqInstance = new Queue('channel-verify-queue-dlq', {
            connection: getRedisConnection(redis),
        });
    }
    return channelVerifyDlqInstance;
};