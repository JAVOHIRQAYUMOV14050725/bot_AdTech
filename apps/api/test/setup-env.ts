process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/bot_adtech?schema=public';
process.env.REDIS_HOST ??= '127.0.0.1';
process.env.REDIS_PORT ??= '6379';
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_123456';
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_123456';
process.env.TELEGRAM_BOT_TOKEN ??= 'test_bot_token';
process.env.TELEGRAM_BOT_USERNAME ??= 'adtech_bot';
process.env.TELEGRAM_INTERNAL_TOKEN ??= 'internal-token';
