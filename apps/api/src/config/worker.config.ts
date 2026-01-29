import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type WorkerConfig = {
    postJobMaxAttempts: number;
    postJobRetryBackoffMs: number;
    postJobStalledMinutes: number;
};

export const workerConfig = registerAs(
    'worker',
    (): WorkerConfig => {
        const env = loadEnv();
        return {
            postJobMaxAttempts: env.POST_JOB_MAX_ATTEMPTS,
            postJobRetryBackoffMs: env.POST_JOB_RETRY_BACKOFF_MS,
            postJobStalledMinutes: env.POST_JOB_STALLED_MINUTES,
        };
    },
);
