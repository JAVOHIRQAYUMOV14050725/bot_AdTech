import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DepositResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ example: 'deposit_20240101_abc123' })
    idempotencyKey!: string;

    @ApiPropertyOptional({ example: true })
    idempotent?: boolean;
}