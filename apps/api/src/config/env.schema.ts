import { z } from 'zod';

const booleanString = z
    .enum(['true', 'false'])
    .transform((value: 'true' | 'false') => value === 'true');

export const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(4002),
    NODE_ENV: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().positive(),
    REDIS_PASSWORD: z.string().optional(),
    ENABLE_DEBUG: booleanString.default('false'),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),
    JWT_ISSUER: z.string().min(1).default('bot-adtech'),
    JWT_AUDIENCE: z.string().min(1).default('bot-adtech'),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_AUTOSTART: booleanString.default('false'),
    TELEGRAM_SEND_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    TELEGRAM_SEND_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
    TELEGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
    TELEGRAM_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    TELEGRAM_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    ENABLE_TELEGRAM_SMOKE_TEST: booleanString.default('false'),
    TELEGRAM_TEST_CHANNEL: z.string().optional(),
    WORKER_MODE: booleanString.default('false'),
    WORKER_AUTOSTART: booleanString.default('false'),
    AUTH_RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(5),
    AUTH_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60000),
    POST_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    POST_JOB_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    POST_JOB_STALLED_MINUTES: z.coerce.number().int().positive().default(15),
    CAMPAIGN_TARGET_MIN_LEAD_MS: z.coerce.number().int().positive().default(30000),
    SUPER_ADMIN_TELEGRAM_ID: z.string().optional(),
    SUPER_ADMIN_USERNAME: z.string().optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),
    SUPER_ADMIN_BOOTSTRAP_SECRET: z.string().optional(),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(10),
    LOG_LEVEL: z.string().optional(),
});

export type EnvVars = z.infer<typeof envSchema>;    