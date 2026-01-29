import { envSchema, EnvVars } from './env.schema';

let cachedEnv: EnvVars | null = null;

export const loadEnv = (): EnvVars => {
    if (!cachedEnv) {
        cachedEnv = envSchema.parse(process.env);
    }
    return cachedEnv;
};