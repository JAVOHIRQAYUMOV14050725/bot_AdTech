import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class InternalTelegramVerifyChannelDto {
    @ApiProperty({ example: 'publisher-id' })
    @IsString()
    publisherId!: string;

    @ApiProperty({ example: '123456789' })
    @IsString()
    telegramUserId!: string;

    @ApiPropertyOptional({ example: '@channel' })
    @IsOptional()
    @IsString()
    identifier?: string;
}