import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { KillSwitchKey } from '@prisma/client';

export class KillSwitchDto {
    @IsEnum(KillSwitchKey)
    key: KillSwitchKey;

    @IsBoolean()
    enabled: boolean;

    @IsString()
    @IsOptional()
    reason?: string;
}
