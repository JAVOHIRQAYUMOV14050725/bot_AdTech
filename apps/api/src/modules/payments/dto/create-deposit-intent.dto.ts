import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateDepositIntentDto {
    @ApiProperty({ example: '25.00' })
    @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal' })
    amount!: string;

    @ApiProperty({ example: 'deposit-uuid' })
    @IsString()
    @IsNotEmpty()
    idempotencyKey!: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    returnUrl?: string;
}