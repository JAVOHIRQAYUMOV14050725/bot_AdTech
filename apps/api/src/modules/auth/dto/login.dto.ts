import { ApiProperty } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';

export class LoginDto {
    @ApiProperty({
        example: TELEGRAM_ID_EXAMPLE,
        description: 'Telegram user ID as digits-only string.',
        pattern: '^\\d+$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramIdString()
    telegramId!: string;

    @ApiProperty({
        example: 'StrongPassw0rd!',
        minLength: 8,
        maxLength: 128,
    })
    @TrimString()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @IsNotEmpty()
    password!: string;
}