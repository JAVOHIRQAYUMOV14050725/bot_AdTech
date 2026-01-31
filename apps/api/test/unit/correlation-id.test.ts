import { strict as assert } from 'assert';
import {
    correlationIdMiddleware,
    isValidCorrelationId,
} from '../../src/common/middleware/correlation-id.middleware';

type MockRequest = {
    headers: Record<string, unknown>;
    correlationId?: string;
};

type MockResponse = {
    headers: Record<string, string>;
    setHeader: (name: string, value: string) => void;
};

const createResponse = (): MockResponse => {
    const headers: Record<string, string> = {};
    return {
        headers,
        setHeader: (name, value) => {
            headers[name] = value;
        },
    };
};

export const runCorrelationIdTests = () => {
    {
        const request: MockRequest = {
            headers: { 'x-correlation-id': 'not-a-uuid' },
        };
        const response = createResponse();
        let nextCalled = false;

        correlationIdMiddleware(
            request as any,
            response as any,
            () => {
                nextCalled = true;
            },
        );

        assert.ok(nextCalled, 'middleware should call next');
        assert.ok(request.correlationId, 'correlationId should be set');
        assert.ok(
            isValidCorrelationId(request.correlationId),
            'correlationId should be a valid uuid v4',
        );
        assert.equal(
            response.headers['X-Correlation-Id'],
            request.correlationId,
            'response should echo correlation id',
        );
    }

    {
        const validId = '4d2b9c5a-3f0a-4e51-9f3a-9c23b089d96a';
        const request: MockRequest = {
            headers: { 'x-correlation-id': validId },
        };
        const response = createResponse();

        correlationIdMiddleware(request as any, response as any, () => undefined);

        assert.equal(
            request.correlationId,
            validId,
            'valid correlationId should be preserved',
        );
        assert.equal(
            response.headers['X-Correlation-Id'],
            validId,
            'response should echo valid correlation id',
        );
    }
};
