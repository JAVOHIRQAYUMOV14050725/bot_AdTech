export type TelegramFailureReason =
    | 'RATE_LIMIT'
    | 'NETWORK'
    | 'TIMEOUT'
    | 'BREAKER_OPEN'
    | 'CHAT_NOT_FOUND'
    | 'BOT_NOT_ADMIN'
    | 'BOT_KICKED'
    | 'UNKNOWN';

type ErrorOptions = {
    cause?: unknown;
};

export class TelegramBaseError extends Error {
    readonly reason: TelegramFailureReason;

    constructor(message: string, reason: TelegramFailureReason, options?: ErrorOptions) {
        super(message);
        this.name = this.constructor.name;
        this.reason = reason;
        if (options?.cause) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

export class TelegramTransientError extends TelegramBaseError {
    readonly isTransient = true;
}

export class TelegramPermanentError extends TelegramBaseError {
    readonly isTransient = false;
}

export class TelegramTimeoutError extends TelegramTransientError {
    readonly timeoutMs: number;

    constructor(action: string, timeoutMs: number, options?: ErrorOptions) {
        super(`Telegram ${action} timed out after ${timeoutMs}ms`, 'TIMEOUT', options);
        this.timeoutMs = timeoutMs;
    }
}

export class TelegramCircuitBreakerOpenError extends TelegramTransientError {
    constructor(options?: ErrorOptions) {
        super('Telegram circuit breaker is open', 'BREAKER_OPEN', options);
    }
}
