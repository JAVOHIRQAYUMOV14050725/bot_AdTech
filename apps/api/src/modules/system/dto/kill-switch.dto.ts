import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { KillSwitchKey } from '@prisma/client';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class KillSwitchDto {
    @ApiProperty({ enum: KillSwitchKey })
    @IsEnum(KillSwitchKey)
    key!: KillSwitchKey;

    @ApiProperty({ example: true })
    @IsBoolean()
    enabled!: boolean;

    @ApiPropertyOptional({
        example: 'Maintenance window.',
        minLength: 3,
        maxLength: 500,
    })
    @TrimString()
    @IsString()
    @IsOptional()
    @MinLength(3)
    @MaxLength(500)
    reason: string;
}