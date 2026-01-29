import { ConfigType, registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const authConfig = registerAs('auth', () => {
    const env = loadEnv();
    return {
        bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
        bootstrapSecret: env.SUPER_ADMIN_BOOTSTRAP_SECRET ?? null,
    };
});

export type AuthConfig = ConfigType<typeof authConfig>;
