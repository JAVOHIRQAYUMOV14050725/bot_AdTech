import { IsOptional, IsString } from 'class-validator';

export class ChannelDecisionDto {
    @IsOptional()
    @IsString()
    reason?: string;
}
