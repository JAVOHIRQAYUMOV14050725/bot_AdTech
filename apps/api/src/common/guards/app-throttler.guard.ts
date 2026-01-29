import { ExecutionContext, Inject, Injectable, LoggerService } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';
import { RequestContext } from '@/common/context/request-context';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
    constructor(
        private readonly storage: ThrottlerStorage,
        @Inject('LOGGER') private readonly logger: LoggerService,
        reflector: Reflector,
    ) {
        // options: default throttlers already configured in module,
        // but guard constructor still requires them
        super({ throttlers: [{ ttl: 60, limit: 1000 }] } as any, storage as any, reflector);
    }

    protected async getTracker(request: Record<string, any>): Promise<string> {
        const actorId = request.user?.id;
        if (actorId) return `user:${actorId}`;

        const forwarded = request.headers?.['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const ip = request.ip ?? forwardedIp ?? 'unknown';
        return `ip:${ip}`;
    }

    protected async throwThrottlingException(
        context: ExecutionContext,
        throttlerLimitDetail: any,
    ): Promise<void> {
        const request = context.switchToHttp().getRequest();
        const correlationId =
            request?.correlationId ?? RequestContext.getCorrelationId() ?? null;
        const actorId = request?.user?.id ?? RequestContext.getActorId() ?? null;
        const route = request?.originalUrl ?? request?.url ?? 'unknown';

        this.logger.warn(
            {
                event: 'request_throttled',
                alert: true,
                entityType: 'http_request',
                entityId: `${request?.method ?? 'UNKNOWN'} ${route}`,
                correlationId,
                actorId,
                data: {
                    limit: throttlerLimitDetail?.limit,
                    ttl: throttlerLimitDetail?.ttl,
                    name: throttlerLimitDetail?.name,
                    tracker: await this.getTracker(request),
                },
            },
            'AppThrottlerGuard',
        );

        throw new TooManyRequestsException('Too many requests, please try again later');
    }
}
