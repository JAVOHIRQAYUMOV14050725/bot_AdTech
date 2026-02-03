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
        example: '@mychannel',
        description: 'Public @username or t.me/username for the channel.',
    })
    @ValidateIf((o) => !o.telegramChannelId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    channelIdentifier!: string;

    @ApiPropertyOptional({
        example: TELEGRAM_CHANNEL_ID_EXAMPLE,
        description: 'Internal-use only. Real Telegram channel id (not @username or invite link), starting with -100.',
        pattern: '^-100\\d{5,}$',
    })
    @ValidateIf((o) => !o.channelIdentifier)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramChannelIdString()
    telegramChannelId?: string;

    @ApiProperty({
        example: 'My Channel',
        minLength: 2,
        maxLength: 120,
    })
    @TrimString()
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    title?: string;

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
        description: 'Publisher user ID (UUID). Required when ownerTelegramId/ownerIdentifier is not provided.',
        format: 'uuid',
    })
    @ValidateIf((o) => !o.ownerTelegramId && !o.ownerIdentifier)
    @IsUUID()
    @IsNotEmpty()
    ownerId?: string;

    @ApiPropertyOptional({
        example: TELEGRAM_ID_EXAMPLE,
        description: 'Internal-use only. Publisher telegram ID as digits-only string. Required when ownerId is not provided.',
        pattern: '^\\d+$',
    })
    @ValidateIf((o) => !o.ownerId && !o.ownerIdentifier)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramIdString()
    ownerTelegramId?: string;

    @ApiPropertyOptional({
        example: '@publishername',
        description: 'Publisher @username or t.me link for identity resolution.',
    })
    @ValidateIf((o) => !o.ownerId && !o.ownerTelegramId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    ownerIdentifier?: string;
}
