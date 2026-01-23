import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDate,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsDecimalString } from '@/common/validators/decimal-string.decorator';

export class CreateCampaignDto {
    @ApiProperty({
        example: 'Spring Campaign',
        minLength: 3,
        maxLength: 120,
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(120)
    name!: string;

    @ApiProperty({
        example: '1500.00',
        description: 'Total budget as decimal string.',
        pattern: '^\\d+(\\.\\d{1,2})?$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsDecimalString(
        { precision: 14, scale: 2, min: '0.01' },
        { message: 'totalBudget must be a positive decimal string with up to 2 decimals' },
    )
    totalBudget!: string;

    @ApiPropertyOptional({
        example: '2024-02-01T00:00:00.000Z',
        description: 'Optional campaign start date (ISO).',
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    startAt?: Date;

    @ApiPropertyOptional({
        example: '2024-03-01T00:00:00.000Z',
        description: 'Optional campaign end date (ISO).',
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    endAt?: Date;
}