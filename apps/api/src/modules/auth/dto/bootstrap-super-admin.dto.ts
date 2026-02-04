import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class BootstrapSuperAdminDto {
    @ApiProperty({ example: 'superadmin' })
    @IsString()
    @IsNotEmpty()
    username!: string;

    @ApiPropertyOptional({
        example: '@optionalTelegramUsername',
        description: 'Optional identifier for logging only. Telegram is not required for bootstrap.',
    })
    @TrimString()
    @IsOptional()
    @IsString()
    identifier?: string;

    @ApiProperty({ example: 'S3cureP@ssw0rd' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    password!: string;

    @ApiProperty({ example: 'bootstrap-secret' })
    @IsString()
    @IsNotEmpty()
    bootstrapSecret!: string;
}