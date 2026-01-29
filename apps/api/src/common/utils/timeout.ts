export class TimeoutError extends Error {
    readonly timeoutMs: number;
    readonly cause?: unknown;

    constructor(message: string, timeoutMs: number, cause?: unknown) {
        super(message);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
        this.cause = cause;
    }
}

type TimeoutOptions<T extends Error> = {
    timeoutMs: number;
    onTimeout?: () => void;
    errorFactory?: (timeoutMs: number, cause?: unknown) => T;
};

export const withTimeout = async <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    options: TimeoutOptions<Error>,
): Promise<T> => {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            options.onTimeout?.();
            const error =
                options.errorFactory?.(options.timeoutMs)
                ?? new TimeoutError('Operation timed out', options.timeoutMs);
            reject(error);
        }, options.timeoutMs);
    });

    try {
        return await Promise.race([fn(controller.signal), timeoutPromise]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};
