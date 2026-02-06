import { resolveErrorUserMessage } from '@/common/errors/error-user-message';
import { shortCorrelationId } from '@/modules/telegram/telegram-context.util';
import { TelegramLocale } from '@/modules/telegram/telegram-safe-text.util';

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

export function mapBackendErrorToTelegramMessage(
    err: unknown,
    locale: TelegramLocale = 'uz',
): string {
    const { code, correlationId } = extractTelegramErrorMeta(err);
    const message = resolveErrorUserMessage(code ?? 'REQUEST_FAILED', locale);
    if (code === 'REQUEST_TIMEOUT') {
        const suffix = shortCorrelationId(correlationId);
        if (suffix) {
            return `${message}\n🆔 ${suffix}`;
        }
    }
    return message;
}
