import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidCorrelationId = (value: unknown): value is string =>
    typeof value === 'string' && UUID_V4_PATTERN.test(value);

export const correlationIdMiddleware = (
    request: Request,
    response: Response,
    next: NextFunction,
): void => {
    const rawHeader =
        request.headers['x-correlation-id'] ??
        request.headers['X-Correlation-Id'];

    const incoming =
        typeof rawHeader === 'string'
            ? rawHeader
            : undefined;

    const correlationId = isValidCorrelationId(incoming)
        ? incoming
        : randomUUID();

    (request as Request & { correlationId?: string }).correlationId =
        correlationId;

    response.setHeader('X-Correlation-Id', correlationId);

    RequestContext.runWithContext({ correlationId }, () => next());
};
