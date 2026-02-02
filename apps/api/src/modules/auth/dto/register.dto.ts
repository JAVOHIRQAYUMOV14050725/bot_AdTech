import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEnum,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { UserRole } from '@/modules/domain/contracts';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';
import { IsTelegramUsername, USERNAME_EXAMPLE } from '@/common/validators/telegram-username.decorator';

export const PUBLIC_ROLES = [
    UserRole.advertiser,
    UserRole.publisher,
] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export class RegisterDto {
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
        description: 'Password with at least 8 characters.',
        minLength: 8,
        maxLength: 128,
    })
    @TrimString()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({
        enum: PUBLIC_ROLES,
        description: 'Role for registration (defaults to publisher).',
        example: UserRole.publisher,
        default: UserRole.publisher,
    })
    @IsOptional()
    @IsEnum(UserRole)
    @IsIn(PUBLIC_ROLES)
    role?: PublicRole;

    @ApiPropertyOptional({
        example: USERNAME_EXAMPLE,
        description: 'Optional Telegram username without @.',
        pattern: '^[A-Za-z0-9_]{5,32}$',
    })
    @TrimString()
    @IsOptional()
    @IsString()
    @IsTelegramUsername()
    username?: string;
}