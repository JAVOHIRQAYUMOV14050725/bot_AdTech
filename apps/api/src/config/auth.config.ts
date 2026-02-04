import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type AuthConfig = {
    bcryptSaltRounds: number;
    bootstrapToken: string | null;
    inviteTokenTtlHours: number;
    allowPublicAdvertisers: boolean;
    telegramBotUsername: string;
    telegramInternalToken: string;
};

export const authConfig = registerAs(
    'auth',
    (): AuthConfig => {
        const env = loadEnv();
        return {
            bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
            bootstrapToken: env.BOOTSTRAP_TOKEN ?? env.SUPER_ADMIN_BOOTSTRAP_SECRET ?? null,
            inviteTokenTtlHours: env.INVITE_TOKEN_TTL_HOURS,
            allowPublicAdvertisers: env.ALLOW_PUBLIC_ADVERTISERS,
            telegramBotUsername: env.TELEGRAM_BOT_USERNAME,
            telegramInternalToken: env.TELEGRAM_INTERNAL_TOKEN,
        };
    },
);