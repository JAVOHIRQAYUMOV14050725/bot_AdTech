import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class InternalTelegramVerifyChannelDto {
    @ApiProperty({ example: 'publisher-id' })
    @IsString()
    publisherId!: string;

    @ApiProperty({ example: '123456789' })
    @IsString()
    telegramUserId!: string;

    @ApiProperty({ example: '@channel' })
    @IsString()
    identifier!: string;
}