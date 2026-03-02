import { envSchema } from '@/config/env.schema';

describe('env schema validation', () => {
    const baseEnv = {
        PORT: '4002',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
        JWT_ACCESS_SECRET: '1234567890123456',
        JWT_REFRESH_SECRET: '1234567890123456',
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_BOT_USERNAME: 'real_bot',
        TELEGRAM_INTERNAL_TOKEN: 'internal-token',
    };

    it('fails in production when click payments are enabled but PUBLIC_BASE_URL is missing', () => {
        const parsed = envSchema.safeParse({
            ...baseEnv,
            NODE_ENV: 'production',
            ENABLE_CLICK_PAYMENTS: 'true',
        });

        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.flatten().fieldErrors.PUBLIC_BASE_URL).toEqual(
                expect.arrayContaining([
                    'PUBLIC_BASE_URL is required when ENABLE_CLICK_PAYMENTS=true in production.',
                ]),
            );
        }
    });

    it('passes in production when PUBLIC_BASE_URL is provided', () => {
        const parsed = envSchema.safeParse({
            ...baseEnv,
            NODE_ENV: 'production',
            ENABLE_CLICK_PAYMENTS: 'true',
            PUBLIC_BASE_URL: 'https://example.com',
        });

        expect(parsed.success).toBe(true);
    });
});