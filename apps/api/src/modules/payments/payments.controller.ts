import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { DepositDto } from './dto/deposit.dto';
import { Prisma, UserRole } from '@prisma/client';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { DepositResponseDto } from './dto/deposit-response.dto';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.advertiser)
@Throttle({ default: { limit: 3, ttl: 300_000 } })
@ApiTags('Payments')
@ApiBearerAuth()
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('deposit')
    @UseGuards(RateLimitGuard)
    @Throttle({ default: { limit: 3, ttl: 300_000 } })
    @ApiOperation({
        summary: 'Deposit funds',
        description: 'Create a wallet deposit for the authenticated advertiser.',
    })
    @ApiOkResponse({ type: DepositResponseDto })
    @ApiStandardErrorResponses()
    deposit(@Actor() actor: { id: string }, @Body() dto: DepositDto) {
        const amount = new Prisma.Decimal(dto.amount);
        return this.paymentsService.deposit(
            actor.id,
            amount,
            dto.idempotencyKey,
        );
    }
}