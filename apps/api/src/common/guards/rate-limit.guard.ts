import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestContext } from '@/common/context/request-context';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
    constructor(@Inject('LOGGER') private readonly logger: LoggerService) {
        super();
    }

    protected getTracker(req: Request): string {
        const actorId = (req as { user?: { id?: string } }).user?.id;
        if (actorId) {
            return `actor:${actorId}`;
        }

        const forwarded = req.headers['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return forwardedIp ?? req.ip ?? 'unknown';
    }

    protected throwThrottlingException(context: ExecutionContext): void {
        const request = context.switchToHttp().getRequest<Request>();
        const actorId = (request as { user?: { id?: string } }).user?.id;
        const correlationId = request.correlationId ?? RequestContext.getCorrelationId() ?? null;

        this.logger.warn(
            {
                event: 'rate_limit_exceeded',
                entityType: 'http_request',
                actorId: actorId ?? null,
                correlationId,
                data: {
                    path: request.originalUrl,
                    method: request.method,
                    ip: request.ip,
                },
            },
            'RateLimitGuard',
        );

        throw new ThrottlerException();
    }
}
