import { ZodError } from 'zod';
import { envSchema, EnvVars } from './env.schema';

let cachedEnv: EnvVars | null = null;

export const loadEnv = (): EnvVars => {
    if (!cachedEnv) {
        try {
            cachedEnv = envSchema.parse(process.env);
            if (cachedEnv.TELEGRAM_INTERNAL_TOKEN === cachedEnv.TELEGRAM_BOT_TOKEN) {
                console.warn(
                    '[env] TELEGRAM_INTERNAL_TOKEN must not equal TELEGRAM_BOT_TOKEN',
                );
            }
        } catch (error) {
            if (error instanceof ZodError) {
                console.error(
                    '[env] validation failed',
                    JSON.stringify(error.flatten(), null, 2),
                );
            } else {
                console.error('[env] validation failed', error);
            }
            throw error;
        }
    }
    return cachedEnv;
};