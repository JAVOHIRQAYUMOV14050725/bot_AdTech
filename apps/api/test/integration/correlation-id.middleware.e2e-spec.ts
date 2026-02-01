import { Request, Response } from 'express';
import { correlationIdMiddleware } from '@/common/middleware/correlation-id.middleware';
import { RequestContext } from '@/common/context/request-context';

describe('CorrelationIdMiddleware', () => {
    it('sets correlationId when header is missing', () => {
        const req = { headers: {} } as Request;
        const res = { setHeader: jest.fn() } as unknown as Response;
        let contextCorrelationId: string | undefined;

        correlationIdMiddleware(req, res, () => {
            contextCorrelationId = RequestContext.getCorrelationId();
        });

        expect(req.correlationId).toBeDefined();
        expect(req.correlationId).not.toEqual('');
        const calls = (res.setHeader as jest.Mock).mock.calls;
        const headerCall = calls.find(([key]) =>
            key.toLowerCase() === 'x-correlation-id'
        );
        expect(headerCall).toBeDefined();
        expect(headerCall![1]).toBe(req.correlationId);

        expect(contextCorrelationId).toEqual(req.correlationId);
    });

    it('preserves incoming x-correlation-id header', () => {
        const incomingCorrelationId = 'test-correlation-id';
        const req = {
            headers: { 'x-correlation-id': incomingCorrelationId },
        } as unknown as Request;
        const res = { setHeader: jest.fn() } as unknown as Response;
        let contextCorrelationId: string | undefined;

        correlationIdMiddleware(req, res, () => {
            contextCorrelationId = RequestContext.getCorrelationId();
        });

        expect(req.correlationId).toEqual(incomingCorrelationId);
        const calls = (res.setHeader as jest.Mock).mock.calls;
        const headerCall = calls.find(([key]) =>
            key.toLowerCase() === 'x-correlation-id'
        );
        expect(headerCall).toBeDefined();
        expect(headerCall![1]).toBe(req.correlationId);

        expect(contextCorrelationId).toEqual(incomingCorrelationId);
    });
});