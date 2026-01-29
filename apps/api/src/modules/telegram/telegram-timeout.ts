export class TelegramTimeoutError extends Error {
    readonly timeoutMs: number;
    readonly action: string;

    constructor(action: string, timeoutMs: number, cause?: Error) {
        super(`Telegram ${action} timed out after ${timeoutMs}ms`);
        this.name = 'TelegramTimeoutError';
        this.action = action;
        this.timeoutMs = timeoutMs;
        if (cause) {
            (this as { cause?: Error }).cause = cause;
        }
    }
}

export const withTelegramTimeout = async <T>(
    action: string,
    timeoutMs: number,
    fn: () => Promise<T>,
): Promise<T> => {
    let timeoutId: NodeJS.Timeout | undefined;
    let timeoutError: TelegramTimeoutError | undefined;
    let timedOut = false;
    const actionPromise = fn().catch((err) => {
        if (timedOut && timeoutError) {
            (timeoutError as { cause?: unknown }).cause = err;
        }
        throw err;
    });
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            timeoutError = new TelegramTimeoutError(action, timeoutMs);
            timedOut = true;
            reject(timeoutError);
        }, timeoutMs);
    });

    try {
        return await Promise.race([actionPromise, timeoutPromise]);
    } catch (err) {
        if (err instanceof TelegramTimeoutError) {
            throw err;
        }
        throw err;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};