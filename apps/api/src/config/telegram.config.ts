import { registerAs } from '@nestjs/config';

export default registerAs('telegram', () => ({
    token: process.env.TELEGRAM_BOT_TOKEN,
    autostart: process.env.TELEGRAM_AUTOSTART === 'true',
    smokeTestEnabled: process.env.ENABLE_TELEGRAM_SMOKE_TEST === 'true',
    testChannel: process.env.TELEGRAM_TEST_CHANNEL,
    sendMaxAttempts: Number(process.env.TELEGRAM_SEND_MAX_ATTEMPTS ?? 3),
    sendBaseDelayMs: Number(process.env.TELEGRAM_SEND_BASE_DELAY_MS ?? 1000),
    requestTimeoutMs: Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS ?? 25000),
    breakerFailureThreshold: Number(process.env.TELEGRAM_BREAKER_FAILURE_THRESHOLD ?? 5),
    breakerResetTimeoutMs: Number(process.env.TELEGRAM_BREAKER_RESET_TIMEOUT_MS ?? 60000),
}));
