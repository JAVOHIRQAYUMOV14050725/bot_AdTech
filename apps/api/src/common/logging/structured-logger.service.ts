import { LoggerService, LogLevel } from '@nestjs/common';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { getCorrelationId } from './correlation-id.store';

/**
 * 🔥 BANK-GRADE LOG PAYLOAD
 */
export type LogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type StructuredLogPayload = {
    timestamp: string;
    level: LogSeverity;

    /** REQUIRED — what happened */
    event: string;

    /** Optional human-readable message */
    message?: unknown;

    /** Traceability */
    correlationId?: string | null;

    /** WHO */
    actorId?: string;
    actorRole?: string;

    /** WHAT */
    entityType?: string;
    entityId?: string;

    /** Context */
    context?: string;

    /** Extra data (sanitized) */
    data?: unknown;

    /** Alerting */
    alert?: boolean;

    /** Stack trace */
    stack?: string;
};

const normalizeLevel = (level: LogLevel): LogSeverity => {
    switch (level) {
        case 'log':
            return 'info';
        case 'verbose':
            return 'debug';
        default:
            return level;
    }
};

export class StructuredLogger implements LoggerService {
    constructor(
        private readonly levels: LogLevel[] = [
            'log',
            'error',
            'warn',
            'debug',
            'verbose',
        ],
    ) { }

    log(message: unknown, context?: string) {
        this.write('log', this.normalizeMessage(message), context);
    }

    warn(message: unknown, context?: string) {
        this.write('warn', this.normalizeMessage(message), context);
    }

    debug(message: unknown, context?: string) {
        this.write('debug', this.normalizeMessage(message), context);
    }

    verbose(message: unknown, context?: string) {
        this.write('verbose', this.normalizeMessage(message), context);
    }

    error(message: unknown, trace?: string, context?: string) {
        this.write(
            'error',
            this.normalizeMessage(message),
            context,
            trace,
        );
    }

    /**
     * 🔒 INTERNAL WRITE
     */
    private write(
        level: LogLevel,
        message: Partial<StructuredLogPayload>,
        context?: string,
        stack?: string,
    ) {
        if (!this.levels.includes(level)) {
            return;
        }

        if (!message?.event) {
            throw new Error(
                'StructuredLogger requires "event" field in log payload',
            );
        }

        const payload: StructuredLogPayload = {
            timestamp: new Date().toISOString(),
            level: normalizeLevel(level),
            event: message.event,
            message: sanitizeForJson(message.message),
            correlationId:
                message.correlationId ?? getCorrelationId() ?? null,

            actorId: message.actorId,
            actorRole: message.actorRole,

            entityType: message.entityType,
            entityId: message.entityId,

            context,
            data: sanitizeForJson(message.data),

            alert: message.alert ?? false,
            stack,
        };

        process.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    /**
     * 🧠 Normalize unknown message into structured payload
     */
    private normalizeMessage(
        message: unknown,
    ): Partial<StructuredLogPayload> {
        if (typeof message === 'object' && message !== null) {
            return message as Partial<StructuredLogPayload>;
        }

        return {
            event: 'log_message',
            message,
        };
    }
}
