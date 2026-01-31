import {
    CallHandler,
    ExecutionContext,
    Injectable,
    LoggerService,
    NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { RequestContext } from '@/common/context/request-context';
import { loadEnv } from '@/config/env';

const getUserId = (request: Request): string | undefined => {
    const user = (request as { user?: { id?: string } }).user;
    const userId =
        user?.id ?? (request as { userId?: string }).userId ?? undefined;
    return userId ? String(userId) : undefined;
};

const env = loadEnv();

const isHealthPath = (path: string | undefined) => {
    if (!path) {
        return false;
    }
    return path === '/health' || path.startsWith('/health/');
};

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
    constructor(private readonly logger: LoggerService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const httpContext = context.switchToHttp();
        const request = httpContext.getRequest<Request>();
        const response = httpContext.getResponse<Response>();
        const start = process.hrtime.bigint();
        const correlationId = request.correlationId ?? RequestContext.getCorrelationId();

        const userId = getUserId(request);
        if (userId) {
            RequestContext.setActorId(userId);
        }

        const requestPath = request.originalUrl ?? request.url;
        const shouldLogRequest = env.LOG_HTTP_HEALTH || !isHealthPath(requestPath);

        if (shouldLogRequest) {
            this.logger.log(
                {
                    event: 'request_received',
                    correlationId: correlationId ?? undefined,
                    data: {
                        method: request.method,
                        path: requestPath,
                        ip: request.ip,
                        userAgent: request.headers['user-agent'],
                        userId,
                    },
                },
                'HttpLoggingInterceptor',
            );
        }

        return next.handle().pipe(
            tap(() => {
                const durationMs =
                    Number(process.hrtime.bigint() - start) / 1_000_000;
                const responseSizeHeader = response.getHeader('content-length');
                const responseSize =
                    typeof responseSizeHeader === 'string'
                        || typeof responseSizeHeader === 'number'
                        ? Number(responseSizeHeader)
                        : undefined;
                if (shouldLogRequest) {
                    this.logger.log(
                        {
                            event: 'request_completed',
                            correlationId: correlationId ?? undefined,
                            data: {
                                method: request.method,
                                path: requestPath,
                                statusCode: response.statusCode,
                                durationMs,
                                responseSize,
                                userId,
                            },
                        },
                        'HttpLoggingInterceptor',
                    );
                }
            }),
            catchError((err) => {
                const durationMs =
                    Number(process.hrtime.bigint() - start) / 1_000_000;
                this.logger.error(
                    {
                        event: 'request_failed',
                        correlationId: correlationId ?? undefined,
                        data: {
                            method: request.method,
                            path: requestPath,
                            statusCode: response.statusCode,
                            durationMs,
                            userId,
                            error:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                            errorType:
                                err instanceof Error ? err.name : undefined,
                        },
                    },
                    err instanceof Error ? err.stack : undefined,
                    'HttpLoggingInterceptor',
                );
                throw err;
            }),
        );
    }
}
