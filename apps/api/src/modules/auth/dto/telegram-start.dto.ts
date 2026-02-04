import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TelegramStartDto {
    @IsString()
    @IsNotEmpty()
    telegramId!: string;

    @ApiPropertyOptional({ example: 'username' })
    @IsOptional()
    @IsString()
    username?: string;

    @ApiPropertyOptional({ example: 'invite-token' })
    @IsOptional()
    @IsString()
    startPayload?: string;
}
