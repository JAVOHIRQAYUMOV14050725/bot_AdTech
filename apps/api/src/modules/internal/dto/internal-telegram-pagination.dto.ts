import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class InternalTelegramPaginationDto {
    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({ default: 5 })
    @IsOptional()
    @IsInt()
    @Min(1)
    pageSize?: number;
}
