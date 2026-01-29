import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type TelegramConfig = {
    botToken: string;
    autostart: boolean;
    sendMaxAttempts: number;
    sendBaseDelayMs: number;
    timeoutMs: number;
    enableSmokeTest: boolean;
    testChannel: string | null;
};

export const telegramConfig = registerAs(
    'telegram',
    (): TelegramConfig => {
        const env = loadEnv();
        return {
            botToken: env.TELEGRAM_BOT_TOKEN,
            autostart: env.TELEGRAM_AUTOSTART,
            sendMaxAttempts: env.TELEGRAM_SEND_MAX_ATTEMPTS,
            sendBaseDelayMs: env.TELEGRAM_SEND_BASE_DELAY_MS,
            timeoutMs: env.TELEGRAM_TIMEOUT_MS,
            enableSmokeTest: env.ENABLE_TELEGRAM_SMOKE_TEST,
            testChannel: env.TELEGRAM_TEST_CHANNEL ?? null,
        };
    },
);
