import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class InvitePublisherDto {
    @ApiPropertyOptional({
        example: 'publisher_handle',
        description: 'Optional username hint to prefill the account.',
    })
    @TrimString()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    username?: string;
}