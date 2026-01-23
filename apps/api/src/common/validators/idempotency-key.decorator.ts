import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._-]+$/;

export function IsIdempotencyKey(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isIdempotencyKey',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') {
                        return false;
                    }
                    if (value.length < 8 || value.length > 128) {
                        return false;
                    }
                    return IDEMPOTENCY_KEY_REGEX.test(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be 8-128 chars and contain only letters, numbers, dot, underscore, or dash`;
                },
            },
        });
    };
}