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

        const payload = sanitizeForJson({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.originalUrl,
            correlationId: request.correlationId ?? 'n/a',
            error: errorResponse,
        });

        const stack = exception instanceof Error ? exception.stack : undefined;
        this.logger.error(
            `[${request.correlationId ?? 'n/a'}] ${request.method} ${request.originalUrl} ${status}`,
            stack ?? String(exception),
        );

        response.status(status).json(payload);
    }
}
