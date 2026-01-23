import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';
import { IsDecimalString } from '@/common/validators/decimal-string.decorator';
import { IsFutureDate } from '@/common/validators/future-date.decorator';

export class CreateTargetDto {
    @ApiProperty({
        example: 'b7a395a5-2ad8-4c1a-a58b-7d0d529e2f3c',
        description: 'Channel UUID.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsUUID()
    channelId!: string;

    @ApiProperty({
        example: '250.00',
        description: 'Target price as decimal string.',
        pattern: '^\\d+(\\.\\d{1,2})?$',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsDecimalString(
        { precision: 12, scale: 2, min: '0.01' },
        { message: 'price must be a positive decimal string with up to 2 decimals' },
    )
    price!: string;

    @ApiProperty({
        example: '2024-02-01T12:00:00.000Z',
        description: 'Scheduled posting time (ISO).',
    })
    @Type(() => Date)
    @IsDate()
    @IsFutureDate()
    scheduledAt!: Date;
}
