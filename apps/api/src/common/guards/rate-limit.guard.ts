import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard, ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestContext } from '@/common/context/request-context';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
    constructor(@Inject('LOGGER') private readonly logger: LoggerService,
        options: ThrottlerModuleOptions,
        storageService: ThrottlerStorage,
        reflector: Reflector,
    ) {
        super(options, storageService, reflector);
    }

    protected async getTracker(req: Record<string, any>): Promise<string> {
        const actorId = (req as { user?: { id?: string } }).user?.id;
        if (actorId) {
            return `actor:${actorId}`;
        }

        const forwarded = req.headers['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return forwardedIp ?? req.ip ?? 'unknown';
    }

    protected async throwThrottlingException(
        context: ExecutionContext,
        throttlerLimitDetail: ThrottlerLimitDetail,
    ): Promise<void> {
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