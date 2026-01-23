import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { DepositDto } from './dto/deposit.dto';
import { Prisma, UserRole } from '@prisma/client';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.advertiser, UserRole.admin, UserRole.super_admin)
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('deposit')
    deposit(@Actor() actor: { id: string }, @Body() dto: DepositDto) {
        const amount = new Prisma.Decimal(dto.amount);
        return this.paymentsService.deposit(
            actor.id,
            amount,
            dto.idempotencyKey,
        );
    }
}
