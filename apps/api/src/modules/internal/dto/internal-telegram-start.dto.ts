import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { IsTelegramIdString } from '@/common/validators/telegram-id-string.decorator';

export class InternalTelegramStartDto {
    @IsString()
    @IsTelegramIdString()
    telegramId!: string;

    @ApiPropertyOptional({ example: 'username' })
    @IsOptional()
    @IsString()
    username?: string;

    @ApiPropertyOptional({ example: 'invite-token' })
    @IsOptional()
    @IsString()
    startPayload?: string;

    @ApiPropertyOptional({ example: '123456' })
    @IsOptional()
    @IsString()
    updateId?: string;
}