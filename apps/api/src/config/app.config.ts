import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const appConfig = registerAs('app', () => {
    const env = loadEnv();
    return {
        nodeEnv: env.NODE_ENV ?? 'development',
        port: env.PORT,
        enableDebug: env.ENABLE_DEBUG,
        enableSwagger: env.ENABLE_SWAGGER,
        workerMode: env.WORKER_MODE,
        workerAutostart: env.WORKER_AUTOSTART,
    };
});
