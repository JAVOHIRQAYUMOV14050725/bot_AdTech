import {
    ExecutionContext,
    Inject,
    Injectable,
    LoggerService,
} from '@nestjs/common';
import {
    ThrottlerGuard,
    ThrottlerModuleOptions,
    ThrottlerStorageService,
    THROTTLER_OPTIONS,
    THROTTLER_STORAGE,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';
import { RequestContext } from '@/common/context/request-context';
import { LOGGER_TOKEN } from '@/common/logging/logging.module';

@Injectable()
export class ThrottlerLoggerGuard extends ThrottlerGuard {
    constructor(
        @Inject(THROTTLER_OPTIONS)
        options: ThrottlerModuleOptions,
        @Inject(THROTTLER_STORAGE)
        storageService: ThrottlerStorageService,
        reflector: Reflector,
        @Inject(LOGGER_TOKEN)
        private readonly logger: LoggerService,
    ) {
        super(options, storageService, reflector);
    }

    protected getTracker(req: Request): string {
        const actorId = (req as Request & { user?: { id?: string } }).user?.id;
        if (actorId) {
            return `user:${actorId}`;
        }

        const forwarded = req.headers['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const ip = req.ip ?? forwardedIp ?? 'unknown';
        return `ip:${ip}`;
    }

    protected throwThrottlingException(
        context: ExecutionContext,
        throttlerLimit: { ttl: number; limit: number },
    ): void {
        const request = context.switchToHttp().getRequest<Request & {
            user?: { id?: string };
            correlationId?: string;
        }>();
        const correlationId =
            request.correlationId ?? RequestContext.getCorrelationId() ?? null;
        const actorId = request.user?.id ?? null;
        const forwarded = request.headers['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const ip = request.ip ?? forwardedIp ?? 'unknown';

        this.logger.warn(
            {
                event: 'throttle_exceeded',
                entityType: 'request',
                entityId: request.path,
                correlationId,
                actorId,
                data: {
                    method: request.method,
                    path: request.path,
                    ip,
                    limit: throttlerLimit.limit,
                    ttl: throttlerLimit.ttl,
                },
            },
            'ThrottlerGuard',
        );

        throw new TooManyRequestsException(
            'Too many requests, please try again later',
        );
    }
}
