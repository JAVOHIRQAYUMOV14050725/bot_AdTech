export function formatTelegramError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    if (typeof err === 'string') {
        return err;
    }

    if (err && typeof err === 'object') {
        const maybeMessage = (err as { message?: unknown }).message;
        if (typeof maybeMessage === 'string') {
            return maybeMessage;
        }

        const maybeResponse = (err as { response?: unknown }).response;
        if (typeof maybeResponse === 'string') {
            return maybeResponse;
        }
        if (maybeResponse && typeof maybeResponse === 'object') {
            const responseMessage = (maybeResponse as { message?: unknown }).message;
            if (typeof responseMessage === 'string') {
                return responseMessage;
            }
            if (Array.isArray(responseMessage)) {
                return responseMessage.join('; ');
            }
        }

        try {
            return JSON.stringify(err);
        } catch {
            return 'Unexpected error';
        }
    }

    return 'Unexpected error';
}
