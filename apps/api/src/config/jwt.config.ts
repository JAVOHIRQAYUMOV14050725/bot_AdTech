import { ConfigService } from '@nestjs/config';
import { EnvVars } from './env.schema';

export type JwtRuntimeConfig = {
    issuer?: string;
    audience?: string;
    access: {
        secret: string;
        expiresIn: string;
    };
    refresh: {
        secret: string;
        expiresIn: string;
    };
};

export const getJwtConfig = (
    configService: ConfigService<EnvVars>,
): JwtRuntimeConfig => ({
    issuer: configService.get<string>('JWT_ISSUER', { infer: true }) ?? undefined,
    audience: configService.get<string>('JWT_AUDIENCE', { infer: true }) ?? undefined,
    access: {
        secret: configService.get<string>('JWT_ACCESS_SECRET', { infer: true })!,
        expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN', { infer: true })!,
    },
    refresh: {
        secret: configService.get<string>('JWT_REFRESH_SECRET', { infer: true })!,
        expiresIn: configService.get<string>('JWT_REFRESH_EXPIRES_IN', { infer: true })!,
    },
});
