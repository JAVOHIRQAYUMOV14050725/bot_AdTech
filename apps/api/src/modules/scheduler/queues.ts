import { Queue } from 'bullmq';

export const postQueue = new Queue('post-queue', {
    connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
    },
});
