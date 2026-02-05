export const sanitizeTelegramBotUsername = (raw: string): string => raw.replace(/^@+/, '').trim();

export const requireTelegramBotUsername = (raw?: string | null): string => {
    const sanitized = raw ? sanitizeTelegramBotUsername(raw) : '';
    if (!sanitized) {
        throw new Error('TELEGRAM_BOT_USERNAME is required');
    }
    return sanitized;
};

export const formatTelegramBotUsernameMention = (raw?: string | null): string =>
    `@${requireTelegramBotUsername(raw)}`;
