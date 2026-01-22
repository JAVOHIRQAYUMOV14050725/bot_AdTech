import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateCampaignDto {
    @IsString()
    name!: string;

    @IsString()
    totalBudget!: string;

    @IsOptional()
    @IsDateString()
    startAt?: string;

    @IsOptional()
    @IsDateString()
    endAt?: string;
}