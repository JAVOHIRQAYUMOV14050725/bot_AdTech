import { IsString, Matches } from 'class-validator';

export class DepositDto {
    @IsString()
    @Matches(/^\d+(\.\d{1,2})?$/)
    amount!: string;

    @IsString()
    @Matches(/^[A-Za-z0-9._-]{8,64}$/)
    idempotencyKey!: string;
}
