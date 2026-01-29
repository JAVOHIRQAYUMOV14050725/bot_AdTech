import { ExecutionContext, Inject, Injectable, LoggerService } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';
import { RequestContext } from '@/common/context/request-context';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
    constructor(@Inject('LOGGER') private readonly logger: LoggerService) {
        super();
    }

    protected getTracker(request: Record<string, any>): string {
        const actorId = request.user?.id;
        if (actorId) {
            return `user:${actorId}`;
        }

        const forwarded = request.headers?.['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const ip = request.ip ?? forwardedIp ?? 'unknown';
        return `ip:${ip}`;
    }

    protected throwThrottlingException(
        context: ExecutionContext,
        throttlerLimit: number,
        ttl: number,
        throttlerName?: string,
    ): never {
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
                    limit: throttlerLimit,
                    ttl,
                    throttlerName,
                    tracker: this.getTracker(request),
                },
            },
            'AppThrottlerGuard',
        );

        throw new TooManyRequestsException(
            'Too many requests, please try again later',
        );
    }
}
