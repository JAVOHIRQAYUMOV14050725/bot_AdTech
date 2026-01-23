import { LoggerService, LogLevel } from '@nestjs/common';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { getCorrelationId } from './correlation-id.store';

type LogPayload = {
    level: string;
    timestamp: string;
    message: unknown;
    context?: string;
    correlationId?: string | null;
    stack?: string;
};

const normalizeLogLevel = (level: LogLevel): string => {
    return level === 'log' ? 'info' : level;
};

export class StructuredLogger implements LoggerService {
    constructor(private readonly levels: LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose']) { }

    log(message: unknown, context?: string) {
        this.write('log', message, context);
    }

    error(message: unknown, trace?: string, context?: string) {
        this.write('error', message, context, trace);
    }

    warn(message: unknown, context?: string) {
        this.write('warn', message, context);
    }

    debug(message: unknown, context?: string) {
        this.write('debug', message, context);
    }

    verbose(message: unknown, context?: string) {
        this.write('verbose', message, context);
    }

    private write(level: LogLevel, message: unknown, context?: string, stack?: string) {
        if (!this.levels.includes(level)) {
            return;
        }

        const payload: LogPayload = {
            level: normalizeLogLevel(level),
            timestamp: new Date().toISOString(),
            message: sanitizeForJson(message),
            context,
            correlationId: getCorrelationId() ?? null,
            stack,
        };

        process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
}