import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class InternalTelegramAdminForceDto {
    @IsString()
    telegramId!: string;

    @IsString()
    campaignTargetId!: string;

    @ApiPropertyOptional({ example: 'admin_force' })
    @IsOptional()
    @IsString()
    reason?: string;
}
