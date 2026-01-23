import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const TELEGRAM_ID_REGEX = /^\d{5,20}$/;

export const TELEGRAM_ID_EXAMPLE = '1234567890';

export function IsTelegramIdString(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isTelegramIdString',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') {
                        return false;
                    }
                    return TELEGRAM_ID_REGEX.test(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a digits-only telegram id string`;
                },
            },
        });
    };
}