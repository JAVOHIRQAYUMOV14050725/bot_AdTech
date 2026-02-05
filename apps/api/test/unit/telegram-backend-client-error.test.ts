import { BackendApiError, parseBackendErrorResponse } from '@/modules/telegram/telegram-backend.client';

describe('telegram backend client error parsing', () => {
    it('extracts message, code, and correlationId from structured error', () => {
        const payload = JSON.stringify({
            event: 'error',
            code: 'INVITE_NOT_FOR_YOU',
            message: 'Invite token does not belong to this Telegram account.',
            correlationId: 'corr-123',
        });
        const parsed = parseBackendErrorResponse(payload, 'fallback-corr', 403);

        expect(parsed.message).toBe('Invite token does not belong to this Telegram account.');
        expect(parsed.code).toBe('INVITE_NOT_FOR_YOU');
        expect(parsed.correlationId).toBe('corr-123');
    });

    it('falls back to safe message when payload message is non-string', () => {
        const payload = JSON.stringify({
            event: 'error',
            code: 'VALIDATION_FAILED',
            message: {},
            correlationId: 'corr-456',
        });
        const parsed = parseBackendErrorResponse(payload, 'fallback-corr', 400);

        expect(typeof parsed.message).toBe('string');
        expect(parsed.message).not.toBe('[object Object]');
    });

    it('throws BackendApiError with string message', () => {
        const err = new BackendApiError({
            status: 500,
            code: null,
            correlationId: 'corr-789',
            message: 'Backend request failed (500)',
        });
        expect(err.message).toBe('Backend request failed (500)');
    });
});
