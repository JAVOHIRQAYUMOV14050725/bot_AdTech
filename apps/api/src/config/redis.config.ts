import { ConfigType, registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const redisConfig = registerAs('redis', () => {
    const env = loadEnv();
    return {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD ?? undefined,
    };
});

export type RedisConfig = ConfigType<typeof redisConfig>;
