import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramUsername, USERNAME_EXAMPLE } from '@/common/validators/telegram-username.decorator';
import { IsDecimalString } from '@/common/validators/decimal-string.decorator';

export class CreateChannelDto {
    @ApiProperty({
        example: '@mychannel',
        description: 'Public @username or t.me/username for the channel.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    channelIdentifier!: string;

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