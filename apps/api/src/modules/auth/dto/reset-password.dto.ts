import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, ValidateIf } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsTelegramIdString, TELEGRAM_ID_EXAMPLE } from '@/common/validators/telegram-id-string.decorator';

export class ResetPasswordDto {
    @ApiProperty({ example: '@username', description: 'Telegram @username or t.me link.' })
    @ValidateIf((o) => !o.telegramId)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    identifier!: string;

    @ApiPropertyOptional({ example: TELEGRAM_ID_EXAMPLE, description: 'Internal-use only. Telegram user ID.' })
    @ValidateIf((o) => !o.identifier)
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsTelegramIdString()
    telegramId?: string;

    @ApiProperty({ example: 'NewS3cureP@ssw0rd' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    newPassword!: string;
}
