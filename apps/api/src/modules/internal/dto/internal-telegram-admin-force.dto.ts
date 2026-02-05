import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { IsTelegramIdString } from '@/common/validators/telegram-id-string.decorator';

export class InternalTelegramAdminForceDto {
    @IsString()
    @IsTelegramIdString()
    telegramId!: string;

    @IsString()
    campaignTargetId!: string;

    @ApiPropertyOptional({ example: 'admin_force' })
    @IsOptional()
    @IsString()
    reason?: string;
}