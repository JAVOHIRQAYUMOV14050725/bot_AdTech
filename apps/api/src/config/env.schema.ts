import { z } from 'zod';

const booleanString = z
    .enum(['true', 'false'])
    .transform((value: 'true' | 'false') => value === 'true');

export const envSchema = z.object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(4002),
    DATABASE_URL: z.string().min(1),
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().positive(),
    REDIS_PASSWORD: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),
    JWT_ISSUER: z.string().min(1).default('bot_AdTech'),
    JWT_AUDIENCE: z.string().min(1).default('bot_AdTech_api'),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_BOT_USERNAME: z
        .string()
        .min(1)
        .refine(
            (value) => value.replace(/^@+/, '').toLowerCase() !== 'change_me_bot',
            { message: 'TELEGRAM_BOT_USERNAME must be configured with a real bot username.' },
        ),
    TELEGRAM_AUTOSTART: booleanString.default('true'),
    TELEGRAM_STARTUP_TEST: booleanString.default('false'),
    TELEGRAM_SEND_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    TELEGRAM_SEND_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
    TELEGRAM_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
    ENABLE_TELEGRAM_SMOKE_TEST: booleanString.default('false'),
    TELEGRAM_TEST_CHANNEL: z.string().optional(),
    TELEGRAM_INTERNAL_TOKEN: z.string().min(1),
    WORKER_MODE: booleanString.default('false'),
    WORKER_AUTOSTART: booleanString.default('false'),
    ENABLE_DEBUG: booleanString.default('false'),
    ENABLE_SWAGGER: booleanString.default('false'),
    ENABLE_LEDGER_INVARIANT_CHECK: booleanString.default('true'),
    ENABLE_CLICK: booleanString.default('false'),
    ENABLE_CLICK_PAYMENTS: booleanString.default('false'),
    ENABLE_WITHDRAWALS: booleanString.default('false'),
    AUTH_RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(5),
    AUTH_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60000),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(10),
    INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
    ALLOW_PUBLIC_ADVERTISERS: booleanString.default('true'),
    POST_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    POST_JOB_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    POST_JOB_STALLED_MINUTES: z.coerce.number().int().positive().default(15),
    CAMPAIGN_TARGET_MIN_LEAD_MS: z.coerce.number().int().positive().default(30000),
    SUPER_ADMIN_TELEGRAM_ID: z.string().optional(),
    SUPER_ADMIN_USERNAME: z.string().optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),
    SUPER_ADMIN_BOOTSTRAP_SECRET: z.string().optional(),
    BOOTSTRAP_TOKEN: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    LOG_HTTP_HEALTH: booleanString.default('true'),
    INTERNAL_API_TOKEN: z.string().optional(),
    TELEGRAM_BACKEND_URL: z.string().optional(),
    CLICK_API_BASE_URL: z.string().optional(),
    CLICK_SERVICE_ID: z.string().optional(),
    CLICK_MERCHANT_ID: z.string().optional(),
    CLICK_SECRET_KEY: z.string().optional(),
    CLICK_SIGN_TIME_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
});

export type EnvVars = z.infer<typeof envSchema>;    
