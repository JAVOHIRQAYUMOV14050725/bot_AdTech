import { Request, Response, NextFunction } from 'express';
import { correlationIdMiddleware } from '@/common/middleware/correlation-id.middleware';
import { RequestContext } from '@/common/context/request-context';
import { randomUUID } from 'crypto';
const incomingCorrelationId = randomUUID();


type TestRequest = Request & { correlationId?: string };

describe('CorrelationIdMiddleware', () => {
    it('sets correlationId when header is missing', () => {
        const req = {
            headers: {},
        } as unknown as TestRequest;

        const res = {
            setHeader: jest.fn(),
        } as unknown as Response;

        const next: NextFunction = jest.fn();

        let contextCorrelationId: string | undefined;

        correlationIdMiddleware(req, res, () => {
            contextCorrelationId = RequestContext.getCorrelationId();
            next();
        });

        // request
        expect(req.correlationId).toBeDefined();
        expect(typeof req.correlationId).toBe('string');
        expect(req.correlationId).not.toBe('');

        // response header
        const calls = (res.setHeader as jest.Mock).mock.calls;
        const headerCall = calls.find(
            ([key]: [string]) => String(key).toLowerCase() === 'x-correlation-id',
        );

        expect(headerCall).toBeDefined();
        expect(headerCall![1]).toBe(req.correlationId);

        // async context
        expect(contextCorrelationId).toBe(req.correlationId);

        // next called
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('preserves incoming x-correlation-id header', () => {

        const req = {
            headers: {
                'x-correlation-id': incomingCorrelationId,
            },
        } as unknown as TestRequest;

        const res = {
            setHeader: jest.fn(),
        } as unknown as Response;

        const next: NextFunction = jest.fn();

        let contextCorrelationId: string | undefined;

        correlationIdMiddleware(req, res, () => {
            contextCorrelationId = RequestContext.getCorrelationId();
            next();
        });

        // request
        expect(req.correlationId).toBe(incomingCorrelationId);

        // response header
        const calls = (res.setHeader as jest.Mock).mock.calls;
        const headerCall = calls.find(
            ([key]: [string]) => String(key).toLowerCase() === 'x-correlation-id',
        );

        expect(headerCall).toBeDefined();
        expect(headerCall![1]).toBe(incomingCorrelationId);

        // async context
        expect(contextCorrelationId).toBe(incomingCorrelationId);

        // next called
        expect(next).toHaveBeenCalledTimes(1);
    });
});
