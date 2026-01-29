import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from '@/common/context/request-context';

export const correlationIdMiddleware = (
    request: Request,
    response: Response,
    next: NextFunction,
): void => {
    const incoming = request.headers['x-correlation-id'];
    const correlationId =
        typeof incoming === 'string' && incoming.trim().length > 0
            ? incoming
            : randomUUID();

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);

    RequestContext.runWithContext({ correlationId }, () => next());
};
