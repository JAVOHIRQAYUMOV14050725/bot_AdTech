import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramChannelIdString, TELEGRAM_CHANNEL_ID_EXAMPLE } from '@/common/validators/telegram-channel-id-string.decorator';
import { IsTelegramUsername, USERNAME_EXAMPLE } from '@/common/validators/telegram-username.decorator';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';

export class AdminCreateChannelDto {
    cpm(cpm: any) {
        throw new Error('Method not implemented.');
    }
    @ApiProperty({
        example: TELEGRAM_CHANNEL_ID_EXAMPLE,
        description: 'This must be the REAL Telegram channel id (not @username or invite link), starting with -100.',
        pattern: '^-100\\d{5,}$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramChannelIdString()
    telegramChannelId!: string;

    @ApiProperty({
        example: 'My Channel',
        minLength: 2,
        maxLength: 120,
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    @MaxLength(120)
    title!: string;

    @ApiPropertyOptional({
        example: USERNAME_EXAMPLE,
        description: 'Telegram channel username without @.',
        pattern: '^[A-Za-z0-9_]{5,32}$',
    })
    @TrimString()
    @IsOptional()
    @IsString()
    @IsTelegramUsername()
    username?: string;

    @ApiPropertyOptional({
        example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c',
        description: 'Publisher user ID (UUID). Required when ownerTelegramId is not provided.',
        format: 'uuid',
    })
    @ValidateIf((o) => !o.ownerTelegramId)
    @IsUUID()
    @IsNotEmpty()
    ownerId?: string;

    @ApiPropertyOptional({
        example: TELEGRAM_ID_EXAMPLE,
        description: 'Publisher telegram ID as digits-only string. Required when ownerId is not provided.',
        pattern: '^\\d+$',
    })
    @ValidateIf((o) => !o.ownerId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramIdString()
    ownerTelegramId?: string;
}