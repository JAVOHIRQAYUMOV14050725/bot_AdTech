import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type RedisConfig = {
    host: string;
    port: number;
    password?: string;
};

export const redisConfig = registerAs(
    'redis',
    (): RedisConfig => {
        const env = loadEnv();
        return {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD ?? undefined,
        };
    },
);
