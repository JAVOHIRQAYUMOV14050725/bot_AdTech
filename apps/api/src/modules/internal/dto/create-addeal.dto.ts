import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateAdDealDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    advertiserId!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    publisherId!: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    channelId?: string | null;

    @ApiProperty({ example: '25.00' })
    @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal' })
    amount!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    idempotencyKey!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    correlationId!: string;
}
