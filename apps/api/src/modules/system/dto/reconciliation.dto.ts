import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export enum ReconciliationMode {
    DRY_RUN = 'dry-run',
    FIX = 'fix',
}

export class ReconciliationDto {
    @ApiPropertyOptional({ enum: ReconciliationMode })
    @IsEnum(ReconciliationMode)
    @IsOptional()
    mode?: ReconciliationMode;

    @ApiPropertyOptional({
        example: 'recon-20240101-abc123',
        maxLength: 128,
    })
    @TrimString()
    @IsString()
    @IsOptional()
    @MaxLength(128)
    correlationId?: string;
}