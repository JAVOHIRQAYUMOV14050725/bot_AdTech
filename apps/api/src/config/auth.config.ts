import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type AuthConfig = {
    bcryptSaltRounds: number;
    bootstrapSecret: string | null;
};

export const authConfig = registerAs(
    'auth',
    (): AuthConfig => {
        const env = loadEnv();
        return {
            bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
            bootstrapSecret: env.SUPER_ADMIN_BOOTSTRAP_SECRET ?? null,
        };
    },
);
