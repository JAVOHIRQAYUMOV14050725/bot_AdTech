import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateAdDealDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    advertiserId!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    publisherId!: string;

    @ApiProperty({ example: '25.00' })
    @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal' })
    amount!: string;
}