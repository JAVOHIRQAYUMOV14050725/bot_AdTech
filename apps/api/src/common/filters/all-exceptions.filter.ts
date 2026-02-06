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
import { resolveErrorUserMessage } from '@/common/errors/error-user-message';
import { randomUUID } from 'crypto';

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
                    return { message: 'Unique constraint violation', code: 'UNIQUE_CONSTRAINT' };
                }
                if (exception.code === 'P2025') {
                    return { message: 'Record not found', code: 'RECORD_NOT_FOUND' };
                }
                return { message: 'Database error', code: 'DATABASE_ERROR' };
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
                const messageValue = (errorResponse as { message?: unknown }).message;
                const message = Array.isArray(messageValue)
                    ? messageValue.join('; ')
                    : typeof messageValue === 'string'
                        ? messageValue
                        : 'Request failed';
                const details = (errorResponse as { details?: unknown }).details ?? {
                    ...errorResponse,
                };
                return {
                    message,
                    details,
                    userMessage: (errorResponse as { userMessage?: unknown }).userMessage,
                };
            }

            return { message: 'Request failed' };
        })();

        const correlationId =
            (request as Request & { correlationId?: string }).correlationId
            ?? RequestContext.getCorrelationId()
            ?? randomUUID();
        const rawCode =
            typeof (errorResponse as { code?: unknown }).code === 'string'
                ? (errorResponse as { code?: string }).code
                : typeof (normalizedError.details as { code?: unknown } | undefined)?.code === 'string'
                    ? (normalizedError.details as { code?: string }).code
                    : null;
        const rawUserMessage =
            typeof (errorResponse as { userMessage?: unknown }).userMessage === 'string'
                ? (errorResponse as { userMessage?: string }).userMessage
                : typeof (normalizedError as { userMessage?: unknown }).userMessage === 'string'
                    ? (normalizedError as { userMessage?: string }).userMessage
                    : typeof (normalizedError.details as { userMessage?: unknown } | undefined)?.userMessage === 'string'
                        ? (normalizedError.details as { userMessage?: string }).userMessage
                        : null;

        const isValidation =
            (errorResponse as { event?: unknown })?.event === 'validation_failed'
            || normalizedError.message === 'Validation failed'
            || Array.isArray(normalizedError.message);

        const errorCode = rawCode
            ?? (isValidation ? 'VALIDATION_FAILED' : null)
            ?? (status === HttpStatus.UNAUTHORIZED ? 'UNAUTHORIZED' : null)
            ?? (status === HttpStatus.FORBIDDEN ? 'FORBIDDEN' : null)
            ?? (status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : null)
            ?? (status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED');

        const userMessage = rawUserMessage ?? resolveErrorUserMessage(errorCode, 'uz');

        const payload = sanitizeForJson({
            statusCode: status,
            code: errorCode,
            message: normalizedError.message,
            userMessage,
            correlationId,
        });

        const stack = exception instanceof Error ? exception.stack : undefined;
        const isFaviconNotFound =
            status === HttpStatus.NOT_FOUND
            && request.originalUrl === '/favicon.ico';
        const logPayload = {
            event: 'http_exception',
            correlationId,
            data: {
                method: request.method,
                path: request.originalUrl,
                statusCode: status,
                error: normalizedError,
                code: errorCode,
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
