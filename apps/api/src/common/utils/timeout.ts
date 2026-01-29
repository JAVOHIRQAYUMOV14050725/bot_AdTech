export type TimeoutOptions = {
    timeoutMs: number;
    onTimeout?: () => void;
    errorFactory?: () => Error;
};

export async function withTimeout<T>(
    action: string,
    fn: (signal: AbortSignal) => Promise<T>,
    options: TimeoutOptions,
): Promise<T> {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            try {
                controller.abort();
                options.onTimeout?.();
            } catch {
                // no-op
            }
            reject(
                options.errorFactory?.()
                ?? new Error(`${action} timed out after ${options.timeoutMs}ms`),
            );
        }, options.timeoutMs);
    });

    try {
        return await Promise.race([fn(controller.signal), timeoutPromise]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}