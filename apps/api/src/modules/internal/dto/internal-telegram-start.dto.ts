import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class InternalTelegramStartDto {
    @IsString()
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