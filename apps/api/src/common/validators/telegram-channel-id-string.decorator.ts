import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const TELEGRAM_CHANNEL_ID_REGEX = /^-100\d+$/;

export const TELEGRAM_CHANNEL_ID_EXAMPLE = '-1001234567890';

export function IsTelegramChannelIdString(
    validationOptions?: ValidationOptions,
) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isTelegramChannelIdString',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') {
                        return false;
                    }
                    return TELEGRAM_CHANNEL_ID_REGEX.test(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must start with -100 and contain only digits`;
                },
            },
        });
    };
}