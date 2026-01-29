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
        expect(res.setHeader).toHaveBeenCalledWith(
            'x-correlation-id',
            req.correlationId,
        );
        expect(contextCorrelationId).toEqual(req.correlationId);
    });

    it('preserves incoming x-correlation-id header', () => {
        const incomingCorrelationId = 'test-correlation-id';
        const req = {
            headers: { 'x-correlation-id': incomingCorrelationId },
        } as Request;
        const res = { setHeader: jest.fn() } as unknown as Response;
        let contextCorrelationId: string | undefined;

        correlationIdMiddleware(req, res, () => {
            contextCorrelationId = RequestContext.getCorrelationId();
        });

        expect(req.correlationId).toEqual(incomingCorrelationId);
        expect(res.setHeader).toHaveBeenCalledWith(
            'x-correlation-id',
            incomingCorrelationId,
        );
        expect(contextCorrelationId).toEqual(incomingCorrelationId);
    });
});
