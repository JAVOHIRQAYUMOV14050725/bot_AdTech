type HttpExceptionLike = {
    getResponse?: () => unknown;
    message?: unknown;
    response?: unknown;
};

type AxiosErrorLike = {
    response?: {
        data?: unknown;
        status?: number;
        statusText?: string;
    };
    message?: unknown;
};

type TelegramBackendErrorLike = {
    code?: unknown;
    correlationId?: unknown;
};

const flattenMessage = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => flattenMessage(entry))
            .filter((entry): entry is string => Boolean(entry));
        if (parts.length) {
            return parts.join('; ');
        }
    }
    if (value && typeof value === 'object') {
        const nestedMessage = (value as { message?: unknown }).message;
        const resolvedNested = flattenMessage(nestedMessage);
        if (resolvedNested) {
            return resolvedNested;
        }
    }
    return null;
};

const stringifyFallback = (value: unknown): string => {
    try {
        const serialized = JSON.stringify(value);
        if (serialized && serialized !== '{}') {
            return serialized;
        }
    } catch {
        // noop
    }
    return 'Unexpected error';
};

export function telegramSafeErrorMessage(err: unknown): string {
    if (typeof err === 'string') {
        return err;
    }

    if (err instanceof Error) {
        return err.message || 'Unexpected error';
    }

    if (!err || typeof err !== 'object') {
        return 'Unexpected error';
    }

    const httpException = err as HttpExceptionLike;
    if (typeof httpException.getResponse === 'function') {
        const response = httpException.getResponse();
        const resolved = flattenMessage(response);
        if (resolved) {
            return resolved;
        }
    }

    const directMessage = flattenMessage((err as { message?: unknown }).message);
    if (directMessage) {
        return directMessage;
    }

    const axiosLike = err as AxiosErrorLike;
    if (axiosLike.response) {
        const responseMessage = flattenMessage(axiosLike.response.data);
        if (responseMessage) {
            return responseMessage;
        }
        const statusMessage = [axiosLike.response.status, axiosLike.response.statusText]
            .filter((value) => value != null)
            .join(' ');
        if (statusMessage) {
            return statusMessage;
        }
    }

    const responseMessage = flattenMessage((err as { response?: unknown }).response);
    if (responseMessage) {
        return responseMessage;
    }

    return stringifyFallback(err);
}

export function extractTelegramErrorMeta(err: unknown): { code: string | null; correlationId: string | null } {
    if (!err || typeof err !== 'object') {
        return { code: null, correlationId: null };
    }

    const backendError = err as TelegramBackendErrorLike;
    const code = typeof backendError.code === 'string' ? backendError.code : null;
    const correlationId =
        typeof backendError.correlationId === 'string' ? backendError.correlationId : null;

    return { code, correlationId };
}

export function telegramSafeErrorMessageWithCorrelation(err: unknown): string {
    const message = telegramSafeErrorMessage(err);
    const { correlationId } = extractTelegramErrorMeta(err);
    if (!correlationId) {
        return message;
    }
    const shortId = correlationId.slice(0, 8);
    return `${message}\n\nRef: ${shortId}`;
}
