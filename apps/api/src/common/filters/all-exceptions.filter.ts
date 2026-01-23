import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sanitizeForJson } from '@/common/serialization/sanitize';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const isHttpException = exception instanceof HttpException;
        const status = isHttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        const errorResponse = isHttpException
            ? exception.getResponse()
            : { message: 'Internal server error' };

        const normalizedError = (() => {
            if (typeof errorResponse === 'string') {
                return { message: errorResponse };
            }

            if (Array.isArray(errorResponse)) {
                return { message: 'Validation failed', details: errorResponse };
            }

            if (typeof errorResponse === 'object' && errorResponse !== null) {
                const message = (errorResponse as { message?: unknown }).message;
                const details = { ...errorResponse };
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
            correlationId: request.correlationId ?? 'n/a',
            error: normalizedError,
        });

        const stack = exception instanceof Error ? exception.stack : undefined;
        this.logger.error(
            {
                event: 'http_error',
                correlationId: request.correlationId ?? 'n/a',
                method: request.method,
                path: request.originalUrl,
                statusCode: status,
                error: normalizedError,
            },
            stack ?? String(exception),
        );

        response.status(status).json(payload);
    }
}