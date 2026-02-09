import { ERROR_USER_MESSAGES, resolveErrorUserMessage } from '@/common/errors/error-user-message';
import { shortCorrelationId } from '@/modules/telegram/telegram-context.util';
import { TelegramLocale } from '@/modules/telegram/telegram-safe-text.util';
import {
    backToAdvertiserMenuKeyboard,
    cancelFlowKeyboard,
    insufficientBalanceKeyboard,
} from '@/modules/telegram/keyboards';

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

export function mapBackendErrorToTelegramResponse(
    err: unknown,
    locale: TelegramLocale = 'uz',
): { message: string; keyboard?: Parameters<import('telegraf').Context['telegram']['editMessageText']>[4] } {
    const { code, correlationId, userMessage } = extractTelegramErrorMeta(err);
    const fallbackMessage = resolveErrorUserMessage(code ?? 'REQUEST_FAILED', locale);
    let message = userMessage ?? fallbackMessage;
    const suffix = shortCorrelationId(correlationId);
    const hasKnownMapping = Boolean(code && ERROR_USER_MESSAGES[code]);

    if ((!hasKnownMapping || code === 'REQUEST_TIMEOUT' || code === 'REQUEST_FAILED') && suffix) {
        message = `${message}\n🆔 ${suffix}`;
    }

    const keyboard = (() => {
        switch (code) {
            case 'INSUFFICIENT_WALLET_BALANCE':
                return insufficientBalanceKeyboard;
            case 'PAYMENTS_DISABLED':
                return backToAdvertiserMenuKeyboard;
            case 'PUBLISHER_NOT_FOUND':
            case 'INVALID_CHANNEL_INPUT':
                return cancelFlowKeyboard;
            default:
                return undefined;
        }
    })();

    return { message, keyboard };
}

export function mapBackendErrorToTelegramMessage(
    err: unknown,
    locale: TelegramLocale = 'uz',
): string {
    return mapBackendErrorToTelegramResponse(err, locale).message;
}
