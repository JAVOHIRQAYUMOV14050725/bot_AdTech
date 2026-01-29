import { ConfigService } from '@nestjs/config';
import { EnvVars } from './env.schema';

export const buildRedisConnection = (configService: ConfigService<EnvVars>) => ({
    host: configService.get<string>('REDIS_HOST', { infer: true }),
    port: configService.get<number>('REDIS_PORT', { infer: true }),
    password: configService.get<string>('REDIS_PASSWORD', { infer: true }),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000),
});
