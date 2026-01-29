import { Global, Module } from '@nestjs/common';
import {
    buildStructuredLogger,
} from '@/common/logging/structured-logger.service';

export const LOGGER_TOKEN = 'LOGGER';

@Global()
@Module({
    providers: [{ provide: LOGGER_TOKEN, useFactory: buildStructuredLogger }],
    exports: [LOGGER_TOKEN],
})
export class LoggingModule { }
