import { IsString, IsNotEmpty } from 'class-validator';

export class ForceRefundDto {
    @IsString()
    @IsNotEmpty()
    campaignTargetId: string;

    @IsString()
    @IsNotEmpty()
    reason: string; // audit uchun
}
