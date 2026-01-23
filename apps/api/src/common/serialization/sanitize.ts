import Decimal from 'decimal.js';

const isDecimalInstance = (value: unknown): value is Decimal => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (value instanceof Decimal) {
        return true;
    }

    const constructorName = (value as { constructor?: { name?: string } })
        .constructor?.name;
    return constructorName === 'Decimal'
        && typeof (value as Decimal).toFixed === 'function';
};

export const sanitizeForJson = <T>(value: T, seen = new WeakMap()): T => {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString() as T;
    }

    if (isDecimalInstance(value)) {
        return value.toString() as T;
    }

    if (value instanceof Date) {
        return value.toISOString() as T;
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        } as T;
    }

    if (Buffer.isBuffer(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForJson(item, seen)) as T;
    }

    if (typeof value === 'object') {
        if (seen.has(value as object)) {
            return '[Circular]' as T;
        }

        if (value instanceof Map) {
            const mapResult: Record<string, unknown> = {};
            seen.set(value as object, mapResult as T);
            for (const [key, val] of value.entries()) {
                mapResult[String(key)] = sanitizeForJson(val, seen);
            }
            return mapResult as T;
        }

        if (value instanceof Set) {
            const setResult = Array.from(value.values()).map((item) =>
                sanitizeForJson(item, seen),
            );
            seen.set(value as object, setResult as T);
            return setResult as T;
        }

        const result: Record<string, unknown> = {};
        seen.set(value as object, result as T);
        for (const [key, val] of Object.entries(value)) {
            result[key] = sanitizeForJson(val, seen);
        }
        return result as T;
    }

    return value;
};

export const safeJsonStringify = (value: unknown): string => {
    return JSON.stringify(sanitizeForJson(value));
};
