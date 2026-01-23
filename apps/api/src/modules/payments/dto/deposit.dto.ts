import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsDecimalString } from '@/common/validators/decimal-string.decorator';
import { IsIdempotencyKey } from '@/common/validators/idempotency-key.decorator';

export class DepositDto {
    @ApiProperty({
        example: '100.00',
        description: 'Deposit amount as decimal string.',
        pattern: '^\\d+(\\.\\d{1,2})?$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsDecimalString(
        { precision: 14, scale: 2, min: '0.01' },
        { message: 'amount must be a positive decimal string with up to 2 decimals' },
    )
    amount!: string;

    @ApiProperty({
        example: 'deposit_20240101_abc123',
        description: 'Idempotency key for safe retries.',
        minLength: 8,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._-]+$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsIdempotencyKey()
    idempotencyKey!: string;
}
