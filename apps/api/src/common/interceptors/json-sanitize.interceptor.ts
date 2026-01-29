import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { Readable } from 'stream';

@Injectable()
export class JsonSanitizeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
        );
    }
}
