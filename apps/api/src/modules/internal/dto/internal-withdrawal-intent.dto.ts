import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class InternalWithdrawalIntentDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    userId!: string;

    @ApiProperty({ example: '25.00' })
    @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal' })
    amount!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    idempotencyKey!: string;
}