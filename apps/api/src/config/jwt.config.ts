import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type JwtConfig = {
    issuer: string;
    audience: string;
    access: {
        secret: string;
        expiresIn: string;
    };
    refresh: {
        secret: string;
        expiresIn: string;
    };
};

export const jwtConfig = registerAs(
    'jwt',
    (): JwtConfig => {
        const env = loadEnv();
        return {
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
            access: {
                secret: env.JWT_ACCESS_SECRET,
                expiresIn: env.JWT_ACCESS_EXPIRES_IN,
            },
            refresh: {
                secret: env.JWT_REFRESH_SECRET,
                expiresIn: env.JWT_REFRESH_EXPIRES_IN,
            },
        };
    },
);
