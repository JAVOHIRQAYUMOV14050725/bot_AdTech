import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class FundAdDealDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    provider!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    providerReference!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    amount!: string;
}
