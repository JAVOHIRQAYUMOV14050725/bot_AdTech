import { resolveErrorUserMessage } from '@/common/errors/error-user-message';

type TelegramBackendErrorLike = {
    code?: unknown;
    correlationId?: unknown;
    status?: unknown;
    httpStatus?: unknown;
    userMessage?: unknown;
};
export function extractTelegramErrorMeta(err: unknown): {
    code: string | null;
    correlationId: string | null;
    status: number | null;
    userMessage: string | null;
} {
    if (!err || typeof err !== 'object') {
        return { code: null, correlationId: null, status: null, userMessage: null };
    }

    const backendError = err as TelegramBackendErrorLike;
    const code = typeof backendError.code === 'string' ? backendError.code : null;
    const correlationId =
        typeof backendError.correlationId === 'string' ? backendError.correlationId : null;
    const status =
        typeof backendError.httpStatus === 'number'
            ? backendError.httpStatus
            : typeof backendError.status === 'number'
                ? backendError.status
                : null;
    const userMessage =
        typeof backendError.userMessage === 'string' ? backendError.userMessage : null;

    return { code, correlationId, status, userMessage };
}

export function mapBackendErrorToTelegramMessage(err: unknown): string {
    const { code, status } = extractTelegramErrorMeta(err);
    if (code) {
        return resolveErrorUserMessage(code, 'uz');
    }

    if (status === 400) {
        return resolveErrorUserMessage('REQUEST_FAILED', 'uz');
    }
    if (status === 401 || status === 403) {
        return resolveErrorUserMessage('UNAUTHORIZED', 'uz');
    }
    if (status === 429) {
        return '⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.';
    }

    return resolveErrorUserMessage('REQUEST_FAILED', 'uz');
}