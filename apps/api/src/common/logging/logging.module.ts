import { Global, Module } from '@nestjs/common';
import {
    buildStructuredLogger,
} from '@/common/logging/structured-logger.service';
import { AppThrottlerGuard } from '@/common/guards/app-throttler.guard';

export const LOGGER_TOKEN = 'LOGGER';

@Global()
@Module({
    providers: [
        { provide: LOGGER_TOKEN, useFactory: buildStructuredLogger },
        AppThrottlerGuard,
    ],
    exports: [LOGGER_TOKEN, AppThrottlerGuard],
})
export class LoggingModule { }