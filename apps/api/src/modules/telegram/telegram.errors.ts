export class TelegramTimeoutError extends Error {
    readonly timeoutMs: number;
    readonly cause?: unknown;

    constructor(message: string, timeoutMs: number, cause?: unknown) {
        super(message);
        this.name = 'TelegramTimeoutError';
        this.timeoutMs = timeoutMs;
        this.cause = cause;
    }
}

export class TelegramCircuitOpenError extends Error {
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'TelegramCircuitOpenError';
        this.cause = cause;
    }
}

export class TelegramTransientError extends Error {
    readonly retryAfterSeconds?: number | null;
    readonly cause?: unknown;

    constructor(message: string, retryAfterSeconds?: number | null, cause?: unknown) {
        super(message);
        this.name = 'TelegramTransientError';
        this.retryAfterSeconds = retryAfterSeconds;
        this.cause = cause;
    }
}

export class TelegramPermanentError extends Error {
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'TelegramPermanentError';
        this.cause = cause;
    }
}

export const isTelegramRetryableError = (err: unknown): boolean =>
    err instanceof TelegramTimeoutError
    || err instanceof TelegramTransientError
    || err instanceof TelegramCircuitOpenError;

export const isTelegramPermanentError = (err: unknown): boolean =>
    err instanceof TelegramPermanentError;
