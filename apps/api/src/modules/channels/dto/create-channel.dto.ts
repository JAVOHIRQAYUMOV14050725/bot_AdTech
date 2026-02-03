import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramChannelIdString, TELEGRAM_CHANNEL_ID_EXAMPLE } from '@/common/validators/telegram-channel-id-string.decorator';
import { IsTelegramUsername, USERNAME_EXAMPLE } from '@/common/validators/telegram-username.decorator';
import { IsDecimalString } from '@/common/validators/decimal-string.decorator';

export class CreateChannelDto {
    @ApiProperty({
        example: '@mychannel',
        description: 'Public @username or t.me/username for the channel.',
    })
    @ValidateIf((o) => !o.telegramChannelId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    channelIdentifier?: string;

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

    @ApiPropertyOptional({
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

    @IsOptional()
    @IsString()
    @IsDecimalString(
        { precision: 10, scale: 2, min: '0' },
        { message: 'cpm must be a decimal string with up to 2 decimals' },
    )
    @ApiPropertyOptional({
        example: '12.50',
        description: 'Cost per mille (USD), decimal string.',
        pattern: '^\\d+(\\.\\d{1,2})?$',
    })
    cpm?: string;
}