import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';

export class TelegramStartDto {
    @ApiProperty({
        example: TELEGRAM_ID_EXAMPLE,
        description: 'Telegram user id (provided by the bot).',
    })
    @IsString()
    @IsNotEmpty()
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