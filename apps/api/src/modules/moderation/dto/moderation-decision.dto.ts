import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class ModerationDecisionDto {
    @ApiPropertyOptional({
        example: 'Creative violates guidelines.',
        minLength: 3,
        maxLength: 500,
    })
    @TrimString()
    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(500)
    reason?: string;
}