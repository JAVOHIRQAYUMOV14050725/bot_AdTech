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
            CLICK_SERVICE_ID: 'svc',
            CLICK_MERCHANT_ID: 'mer',
            CLICK_USER_ID: 'usr',
            CLICK_SECRET_KEY: 'secret',
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

    it('fails when click config uses placeholders', () => {
        const parsed = envSchema.safeParse({
            ...baseEnv,
            ENABLE_CLICK_PAYMENTS: 'true',
            CLICK_SERVICE_ID: '...',
            CLICK_MERCHANT_ID: 'CHANGE_ME',
            CLICK_USER_ID: '',
            CLICK_SECRET_KEY: 'secret',
        });

        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            const errs = parsed.error.flatten().fieldErrors;
            expect(errs.CLICK_SERVICE_ID?.[0]).toContain('must not be a placeholder');
            expect(errs.CLICK_MERCHANT_ID?.[0]).toContain('must not be a placeholder');
            expect(errs.CLICK_USER_ID?.[0]).toContain('must not be a placeholder');
        }
    });

    it('requires USD_TO_UZS_RATE in uzs_tiyin mode', () => {
        const parsed = envSchema.safeParse({
            ...baseEnv,
            ENABLE_CLICK_PAYMENTS: 'true',
            CLICK_SERVICE_ID: 'svc',
            CLICK_MERCHANT_ID: 'mer',
            CLICK_USER_ID: 'usr',
            CLICK_SECRET_KEY: 'secret',
            CLICK_AMOUNT_MODE: 'uzs_tiyin',
        });

        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.flatten().fieldErrors.USD_TO_UZS_RATE).toEqual(
                expect.arrayContaining([
                    'USD_TO_UZS_RATE is required when CLICK_AMOUNT_MODE=uzs_tiyin.',
                ]),
            );
        }
    });
});
