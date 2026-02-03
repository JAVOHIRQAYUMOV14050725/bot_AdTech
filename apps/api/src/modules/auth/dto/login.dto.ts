import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';

export class LoginDto {
    @ApiProperty({
        example: '@username',
        description: 'Telegram @username or t.me link.',
    })
    @ValidateIf((o) => !o.telegramId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    identifier!: string;

    @ApiPropertyOptional({
        example: TELEGRAM_ID_EXAMPLE,
        description: 'Internal-use only. Telegram user ID as digits-only string.',
        pattern: '^\\d+$',
    })
    @ValidateIf((o) => !o.identifier)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramIdString()
    telegramId?: string;

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
