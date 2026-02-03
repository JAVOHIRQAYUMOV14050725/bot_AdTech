import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramUsername, USERNAME_EXAMPLE } from '@/common/validators/telegram-username.decorator';

export class AdminCreateChannelDto {
    cpm(cpm: any) {
        throw new Error('Method not implemented.');
    }
    @ApiProperty({
        example: '@mychannel',
        description: 'Public @username or t.me/username for the channel.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    channelIdentifier!: string;

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
        description: 'Publisher user ID (UUID). Required when ownerIdentifier is not provided.',
        format: 'uuid',
    })
    @IsUUID()
    @IsNotEmpty()
    ownerId?: string;

    @ApiPropertyOptional({
        example: '@publishername',
        description: 'Publisher @username or t.me link for identity resolution.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    ownerIdentifier?: string;
}