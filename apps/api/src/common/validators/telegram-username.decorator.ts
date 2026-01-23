import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const USERNAME_REGEX = /^[A-Za-z0-9_]{5,32}$/;

export const USERNAME_EXAMPLE = 'channel_handle';

export function IsTelegramUsername(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isTelegramUsername',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') {
                        return false;
                    }
                    return USERNAME_REGEX.test(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a telegram-style username without @`;
                },
            },
        });
    };
}