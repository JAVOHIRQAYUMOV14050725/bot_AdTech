import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4002),
    logLevel: process.env.LOG_LEVEL,
    enableDebug: process.env.ENABLE_DEBUG === 'true',
    workerMode: process.env.WORKER_MODE === 'true',
    workerAutostart: process.env.WORKER_AUTOSTART === 'true',
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
    superAdminBootstrapSecret: process.env.SUPER_ADMIN_BOOTSTRAP_SECRET,
    postJob: {
        maxAttempts: Number(process.env.POST_JOB_MAX_ATTEMPTS ?? 3),
        retryBackoffMs: Number(process.env.POST_JOB_RETRY_BACKOFF_MS ?? 5000),
        stalledMinutes: Number(process.env.POST_JOB_STALLED_MINUTES ?? 15),
    },
    campaignTargetMinLeadMs: Number(process.env.CAMPAIGN_TARGET_MIN_LEAD_MS ?? 30000),
}));
