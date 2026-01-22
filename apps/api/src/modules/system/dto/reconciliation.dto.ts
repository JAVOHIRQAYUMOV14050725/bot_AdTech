import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReconciliationMode {
    DRY_RUN = 'dry-run',
    FIX = 'fix',
}

export class ReconciliationDto {
    @IsEnum(ReconciliationMode)
    @IsOptional()
    mode?: ReconciliationMode;

    @IsString()
    @IsOptional()
    correlationId?: string;
}