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

const getUserId = (request: Request): string | undefined => {
    const user = (request as { user?: { id?: string } }).user;
    const userId =
        user?.id ?? (request as { userId?: string }).userId ?? undefined;
    return userId ? String(userId) : undefined;
};

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
    constructor(private readonly logger: LoggerService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const httpContext = context.switchToHttp();
        const request = httpContext.getRequest<Request>();
        const response = httpContext.getResponse<Response>();
        const start = process.hrtime.bigint();

        const userId = getUserId(request);
        if (userId) {
            RequestContext.setActorId(userId);
        }

        this.logger.log(
            {
                event: 'request_received',
                data: {
                    method: request.method,
                    path: request.originalUrl ?? request.url,
                    ip: request.ip,
                    userAgent: request.headers['user-agent'],
                    userId,
                },
            },
            'HttpLoggingInterceptor',
        );

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
                this.logger.log(
                    {
                        event: 'request_completed',
                        data: {
                            method: request.method,
                            path: request.originalUrl ?? request.url,
                            statusCode: response.statusCode,
                            durationMs,
                            responseSize,
                            userId,
                        },
                    },
                    'HttpLoggingInterceptor',
                );
            }),
            catchError((err) => {
                const durationMs =
                    Number(process.hrtime.bigint() - start) / 1_000_000;
                this.logger.error(
                    {
                        event: 'request_failed',
                        data: {
                            method: request.method,
                            path: request.originalUrl ?? request.url,
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