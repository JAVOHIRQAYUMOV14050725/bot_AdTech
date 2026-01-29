import { ConfigType, registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const telegramConfig = registerAs('telegram', () => {
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
});

export type TelegramConfig = ConfigType<typeof telegramConfig>;
