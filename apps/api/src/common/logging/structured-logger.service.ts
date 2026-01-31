import { LoggerService, LogLevel } from '@nestjs/common';
import { sanitizeForJson } from '../serialization/sanitize';
import { RequestContext } from '../context/request-context';
import { loadEnv } from '../../config/env';

/**
 * 🔥 BANK-GRADE LOG PAYLOAD
 */
export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogError = {
    name?: string;
    message?: string;
    stack?: string;
    code?: string;
};

export type StructuredLogPayload = {
    timestamp: string;
    level: LogSeverity;

    /** REQUIRED — what happened */
    event: string;

    /** Optional human-readable message */
    message?: unknown;

    /** Traceability */
    correlationId: string | null;

    /** WHO */
    actorId?: string;
    actorRole?: string;

    /** WHAT */
    entityType?: string;
    entityId?: string;

    /** Context */
    context: string;

    /** Extra data (sanitized) */
    data?: unknown;
    err?: StructuredLogError;

    /** Alerting */
    alert?: boolean;

    /** Stack trace */
    stack?: string;
};

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 6;

const SENSITIVE_KEY_PATTERN =
    /(password|passphrase|token|refresh[_-]?token|access[_-]?token|secret|authorization|api[-_]?key|x-api-key|jwt|cookie|set-cookie|session|telegram|bot[_-]?token|database[_-]?url|redis[_-]?url)/i;
const JWT_PATTERN = /(?:^|\s)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:$|\s)/;

const normalizeLevel = (level: LogLevel): LogSeverity => {
    switch (level) {
        case 'log':
            return 'info';
        case 'verbose':
            return 'debug';
        case 'fatal':
            return 'error';
        default:
            return level;
    }
};

type SerializedError = {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};

const getErrorCause = (err: Error): unknown => {
    // ES2022 lib bo'lmasa ham ishlaydi
    return (err as { cause?: unknown }).cause;
};

const serializeError = (error: Error): SerializedError => {
    const cause = getErrorCause(error);

    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause:
            cause instanceof Error
                ? serializeError(cause)
                : sanitizeForJson(cause),
    };
};

const truncateValue = (value: unknown, depth = 0): unknown => {
    if (depth > MAX_DEPTH) {
        return '[Truncated]';
    }

    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
            : value;
    }

    if (Array.isArray(value)) {
        const trimmed = value.slice(0, MAX_ARRAY_LENGTH);
        const mapped = trimmed.map((item) => truncateValue(item, depth + 1));
        if (value.length > MAX_ARRAY_LENGTH) {
            mapped.push(
                `[${value.length - MAX_ARRAY_LENGTH} more items truncated]`,
            );
        }
        return mapped;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const trimmedEntries = entries.slice(0, MAX_OBJECT_KEYS);
        const result: Record<string, unknown> = {};
        for (const [key, val] of trimmedEntries) {
            result[key] = truncateValue(val, depth + 1);
        }
        if (entries.length > MAX_OBJECT_KEYS) {
            result._truncatedKeys = entries.length - MAX_OBJECT_KEYS;
        }
        return result;
    }

    return value;
};

const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
        if (JWT_PATTERN.test(value)) {
            return '[REDACTED]';
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item));
    }

    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(
            value as Record<string, unknown>,
        )) {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                result[key] = '[REDACTED]';
                continue;
            }
            result[key] = redactValue(val);
        }
        return result;
    }

    return value;
};

export const prepareLogValue = (value: unknown): unknown => {
    const sanitized = sanitizeForJson(value);
    const redacted = redactValue(sanitized);
    return truncateValue(redacted);
};

export const buildStructuredLogger = (): StructuredLogger => {
    const env = loadEnv();
    const isProd = env.NODE_ENV === 'production';

    const defaultLevels: LogLevel[] = isProd
        ? ['log', 'error', 'warn']
        : ['log', 'error', 'warn', 'debug', 'verbose'];

    const allowedLevels: LogLevel[] = [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
    ];

    const configuredLevels = env.LOG_LEVEL?.split(',')
        .map((level) => level.trim())
        .filter((level) => allowedLevels.includes(level as LogLevel)) as
        | LogLevel[]
        | undefined;

    return new StructuredLogger(
        configuredLevels && configuredLevels.length > 0
            ? configuredLevels
            : defaultLevels,
    );
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

        const correlationId =
            message.correlationId ?? RequestContext.getCorrelationId();
        const actorId = message.actorId ?? RequestContext.getActorId();
        const messageValue = prepareLogValue(message.message);
        const dataValue = prepareLogValue(message.data);

        const errorSource =
            message.message instanceof Error
                ? message.message
                : message.data instanceof Error
                    ? message.data
                    : undefined;
        const errorPayload = errorSource ? serializeError(errorSource) : undefined;

        const resolvedStack =
            stack
            ?? (message.message instanceof Error
                ? message.message.stack
                : message.data instanceof Error
                    ? message.data.stack
                    : undefined);

        const baseData =
            dataValue && typeof dataValue === 'object'
                ? (dataValue as Record<string, unknown>)
                : dataValue !== undefined
                    ? { value: dataValue }
                    : undefined;

        const errPayload: StructuredLogError | undefined = errorPayload
            ? {
                name: errorPayload.name,
                message: errorPayload.message,
                stack: errorPayload.stack,
                code: typeof (errorSource as { code?: unknown } | undefined)?.code === 'string'
                    ? String((errorSource as { code?: unknown }).code)
                    : undefined,
            }
            : undefined;

        const payload: StructuredLogPayload = {
            timestamp: new Date().toISOString(),
            level: normalizeLevel(level),
            event: message.event,
            message: messageValue,
            correlationId: correlationId ?? null,

            actorId,
            actorRole: message.actorRole,

            entityType: message.entityType,
            entityId: message.entityId,

            context: message.context ?? context ?? 'unknown',
            data: errorPayload
                ? { ...(baseData ?? {}), error: errorPayload }
                : baseData ?? dataValue,
            err: errPayload,

            alert: message.alert ?? false,
            stack: resolvedStack,
        };

        process.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    /**
     * 🧠 Normalize unknown message into structured payload
     */
    private normalizeMessage(
        message: unknown,
    ): Partial<StructuredLogPayload> {
        if (message instanceof Error) {
            return {
                event: 'log_message',
                message,
            };
        }
        if (typeof message === 'object' && message !== null) {
            return message as Partial<StructuredLogPayload>;
        }

        return {
            event: 'log_message',
            message,
        };
    }
}
