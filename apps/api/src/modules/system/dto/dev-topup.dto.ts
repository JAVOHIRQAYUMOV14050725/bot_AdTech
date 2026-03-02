import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class DevTopupDto {
    @ApiProperty()
    @IsUUID()
    userId!: string;

    @ApiProperty({ example: 25 })
    @IsNumber()
    @Min(0.01)
    amountUsd!: number;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    note?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    requestId?: string;
}
