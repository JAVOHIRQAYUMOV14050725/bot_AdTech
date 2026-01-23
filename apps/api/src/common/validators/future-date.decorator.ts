import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export function IsFutureDate(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isFutureDate',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
                        return false;
                    }
                    return value.getTime() > Date.now();
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a future date`;
                },
            },
        });
    };
}
