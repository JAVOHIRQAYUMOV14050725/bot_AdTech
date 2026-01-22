import { IsOptional, IsString } from 'class-validator';

export class ModerationDecisionDto {
    @IsOptional()
    @IsString()
    reason?: string;
}