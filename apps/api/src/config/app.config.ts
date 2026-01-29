import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type AppConfig = {
    nodeEnv: string;
    port: number;
    enableDebug: boolean;
    enableSwagger: boolean;
    workerMode: boolean;
    workerAutostart: boolean;
};

export const appConfig = registerAs(
    'app',
    (): AppConfig => {
        const env = loadEnv();
        return {
            nodeEnv: env.NODE_ENV ?? 'development',
            port: env.PORT,
            enableDebug: env.ENABLE_DEBUG,
            enableSwagger: env.ENABLE_SWAGGER,
            workerMode: env.WORKER_MODE,
            workerAutostart: env.WORKER_AUTOSTART,
        };
    },
);
