import { IsString, IsNotEmpty } from 'class-validator';

export class ForceReleaseDto {
    @IsString()
    @IsNotEmpty()
    campaignTargetId: string;

    @IsString()
    @IsNotEmpty()
    reason: string; // audit uchun
}
