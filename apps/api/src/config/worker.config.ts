import { ConfigType, registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const workerConfig = registerAs('worker', () => {
    const env = loadEnv();
    return {
        postJobMaxAttempts: env.POST_JOB_MAX_ATTEMPTS,
        postJobRetryBackoffMs: env.POST_JOB_RETRY_BACKOFF_MS,
        postJobStalledMinutes: env.POST_JOB_STALLED_MINUTES,
    };
});

export type WorkerConfig = ConfigType<typeof workerConfig>;
