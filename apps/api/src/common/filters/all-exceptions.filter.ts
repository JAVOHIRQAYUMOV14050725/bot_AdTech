import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    LoggerService,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { Prisma } from '@prisma/client';
import { RequestContext } from '@/common/context/request-context';
import { loadEnv } from '@/config/env';

const env = loadEnv();

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    constructor(private readonly logger: LoggerService) { }

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const isPrismaKnownError =
            exception instanceof Prisma.PrismaClientKnownRequestError;
        const isHttpException = exception instanceof HttpException;
        const status = (() => {
            if (isPrismaKnownError) {
                if (exception.code === 'P2002') {
                    return HttpStatus.CONFLICT;
                }
                if (exception.code === 'P2025') {
                    return HttpStatus.NOT_FOUND;
                }
            }
            return isHttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;
        })();

        const errorResponse = (() => {
            if (isPrismaKnownError) {
                if (exception.code === 'P2002') {
                    return { message: 'Unique constraint violation' };
                }
                if (exception.code === 'P2025') {
                    return { message: 'Record not found' };
                }
                return { message: 'Database error' };
            }
            return isHttpException
                ? exception.getResponse()
                : { message: 'Internal server error' };
        })();

        const normalizedError = (() => {
            if (typeof errorResponse === 'string') {
                return { message: errorResponse };
            }

            if (Array.isArray(errorResponse)) {
                return { message: 'Validation failed', details: errorResponse };
            }

            if (typeof errorResponse === 'object' && errorResponse !== null) {
                const message = (errorResponse as { message?: unknown }).message;
                const details = (errorResponse as { details?: unknown }).details ?? {
                    ...errorResponse,
                };
                return {
                    message: Array.isArray(message)
                        ? 'Validation failed'
                        : (message as string | undefined) ?? 'Request failed',
                    details,
                };
            }

            return { message: 'Request failed' };
        })();

        const payload = sanitizeForJson({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.originalUrl,
            correlationId: request.correlationId ?? RequestContext.getCorrelationId() ?? null,
            error: normalizedError,
        });

        const stack = exception instanceof Error ? exception.stack : undefined;
        const isFaviconNotFound =
            status === HttpStatus.NOT_FOUND
            && request.originalUrl === '/favicon.ico';
        const logPayload = {
            event: 'http_exception',
            data: {
                method: request.method,
                path: request.originalUrl,
                statusCode: status,
                error: normalizedError,
                errorType: exception instanceof Error ? exception.name : undefined,
                message: exception instanceof Error ? exception.message : undefined,
            },
        };

        if (isFaviconNotFound && env.NODE_ENV === 'production') {
            this.logger.debug?.(
                {
                    ...logPayload,
                    data: {
                        ...(logPayload.data as Record<string, unknown>),
                        stack,
                    },
                    message: 'Favicon not found',
                } as any,
                'AllExceptionsFilter',
            );
        } else {
            this.logger.error(
                {
                    ...logPayload,
                    message: 'HTTP exception occurred',
                } as any,
                stack,
                'AllExceptionsFilter',
            );
        }


        response.status(status).json(payload);
    }
}