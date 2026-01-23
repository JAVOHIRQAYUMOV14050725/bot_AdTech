import { ValidationError } from 'class-validator';

export interface ValidationErrorDetail {
    field: string;
    constraints: Record<string, string>;
    value?: unknown;
}

export function formatValidationErrors(
    errors: ValidationError[],
): ValidationErrorDetail[] {
    const details: ValidationErrorDetail[] = [];

    const walk = (error: ValidationError, parentPath?: string) => {
        const field = parentPath ? `${parentPath}.${error.property}` : error.property;
        if (error.constraints) {
            details.push({
                field,
                constraints: error.constraints,
                value: error.value,
            });
        }

        if (error.children?.length) {
            error.children.forEach((child) => walk(child, field));
        }
    };

    errors.forEach((error) => walk(error));
    return details;
}
