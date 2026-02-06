import { parseBackendErrorResponse, toErrorMessage, BackendApiError } from '@/modules/telegram/telegram-backend.client';

describe('TelegramBackendClient error parsing', () => {
    it('coerces array messages into a string', () => {
        const payload = JSON.stringify({
            message: ['first issue', 'second issue'],
            code: 'REQUEST_FAILED',
            correlationId: 'body-corr',
        });

        const parsed = parseBackendErrorResponse(payload, 'header-corr', 'req-corr', 400);

        expect(parsed.message).toBe('first issue; second issue');
        expect(parsed.correlationId).toBe('header-corr');
    });

    it('coerces object messages into safe strings', () => {
        const payload = JSON.stringify({
            error: {
                message: { detail: 'Deep failure' },
                details: { code: 'REQUEST_FAILED' },
            },
            correlationId: 'body-corr',
        });

        const parsed = parseBackendErrorResponse(payload, null, 'req-corr', 502);

        expect(parsed.message).not.toBe('[object Object]');
        expect(typeof parsed.message).toBe('string');
        expect(parsed.correlationId).toBe('body-corr');
    });

    it('ensures BackendApiError messages are always strings', () => {
        const message = toErrorMessage({ detail: 'Oops' }, 'fallback');
        const err = new BackendApiError({
            status: 500,
            code: 'REQUEST_FAILED',
            correlationId: 'corr-1',
            message,
        });

        expect(typeof err.message).toBe('string');
        expect(err.message).not.toBe('[object Object]');
        expect(err.httpStatus).toBe(500);
    });
});
