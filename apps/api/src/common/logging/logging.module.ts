import { Global, Module } from '@nestjs/common';
import { StructuredLogger } from '@/common/logging/structured-logger.service';

export const LOGGER_TOKEN = 'LOGGER';

@Global()
@Module({
    providers: [{ provide: LOGGER_TOKEN, useClass: StructuredLogger }],
    exports: [LOGGER_TOKEN],
})
export class LoggingModule { }
