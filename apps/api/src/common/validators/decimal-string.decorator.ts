import Decimal from 'decimal.js';
import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export interface DecimalStringOptions {
    precision: number;
    scale: number;
    min?: string;
    max?: string;
}

export function IsDecimalString(
    options: DecimalStringOptions,
    validationOptions?: ValidationOptions,
) {
    const { precision, scale, min, max } = options;

    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isDecimalString',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') {
                        return false;
                    }

                    if (!/^\d+(\.\d+)?$/.test(value)) {
                        return false;
                    }

                    const [integerPart, fractionPart = ''] = value.split('.');
                    if (fractionPart.length > scale) {
                        return false;
                    }

                    const integerDigits = integerPart.replace(/^0+(?=\d)/, '');
                    const maxIntegerDigits = precision - scale;
                    if (integerDigits.length > maxIntegerDigits) {
                        return false;
                    }

                    try {
                        const decimal = new Decimal(value);
                        if (min !== undefined && decimal.lt(min)) {
                            return false;
                        }
                        if (max !== undefined && decimal.gt(max)) {
                            return false;
                        }
                    } catch {
                        return false;
                    }

                    return true;
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a decimal string with precision ${precision} and scale ${scale}`;
                },
            },
        });
    };
}