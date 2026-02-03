import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalTokenGuard } from '@/common/guards/internal-token.guard';
import { PaymentsService } from '@/modules/payments/payments.service';
import { Prisma } from '@prisma/client';
import { InternalDepositIntentDto } from './dto/internal-deposit-intent.dto';
import { InternalWithdrawalIntentDto } from './dto/internal-withdrawal-intent.dto';

@ApiTags('Internal')
@UseGuards(InternalTokenGuard)
@Controller('internal/payments')
export class InternalPaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('deposit-intents')
    createDeposit(@Body() dto: InternalDepositIntentDto) {
        return this.paymentsService.createDepositIntent({
            userId: dto.userId,
            amount: new Prisma.Decimal(dto.amount),
            idempotencyKey: dto.idempotencyKey,
            returnUrl: dto.returnUrl,
        });
    }

    @Post('withdraw-intents')
    createWithdrawal(@Body() dto: InternalWithdrawalIntentDto) {
        return this.paymentsService.createWithdrawalIntent({
            userId: dto.userId,
            amount: new Prisma.Decimal(dto.amount),
            idempotencyKey: dto.idempotencyKey,
        });
    }
}