import {
    CallHandler,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
    StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { Request, Response } from 'express';
import { Readable } from 'stream';

@Injectable()
export class JsonSanitizeInterceptor implements NestInterceptor {
    private readonly logger = new Logger(JsonSanitizeInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const httpContext = context.switchToHttp();
        const request = httpContext.getRequest<Request>();
        const response = httpContext.getResponse<Response>();
        const start = Date.now();

        return next.handle().pipe(
            map((data) => {
                if (data instanceof StreamableFile) {
                    return data;
                }

                if (Buffer.isBuffer(data) || data instanceof Readable) {
                    return data;
                }

                return sanitizeForJson(data);
            }),
            tap(() => {
                const duration = Date.now() - start;
                const correlationId = request.correlationId ?? 'n/a';
                this.logger.log({
                    event: 'http_request',
                    correlationId,
                    method: request.method,
                    path: request.originalUrl,
                    statusCode: response.statusCode,
                    durationMs: duration,
                });
            }),
        );
    }
}
