import { ApiProperty } from '@nestjs/swagger';

export class DepositIntentResponseDto {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    status!: string;

    @ApiProperty()
    paymentUrl!: string | null;
}
