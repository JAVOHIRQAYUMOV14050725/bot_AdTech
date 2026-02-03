import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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
import { Prisma } from '@prisma/client';
import { UserRole } from '@/modules/domain/contracts';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { Throttle } from '@nestjs/throttler';
import { CreateDepositIntentDto } from './dto/create-deposit-intent.dto';
import { DepositIntentResponseDto } from './dto/deposit-intent-response.dto';
import { CreateWithdrawalIntentDto } from './dto/create-withdrawal-intent.dto';

@Controller('payments')
@Throttle({ default: { limit: 3, ttl: 300_000 } })
@ApiTags('Payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('deposit-intents')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.advertiser)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Create deposit intent',
        description: 'Create a Click deposit intent for the authenticated advertiser.',
    })
    @ApiOkResponse({ type: DepositIntentResponseDto })
    @ApiStandardErrorResponses()
    async createDepositIntent(
        @Actor() actor: { id: string },
        @Body() dto: CreateDepositIntentDto,
    ) {
        const amount = new Prisma.Decimal(dto.amount);
        return this.paymentsService.createDepositIntent({
            userId: actor.id,
            amount,
            idempotencyKey: dto.idempotencyKey,
            returnUrl: dto.returnUrl,
        });
    }

    @Post('click/webhook')
    @ApiOperation({
        summary: 'Click webhook handler',
        description: 'Finalize Click deposit or withdrawal intents.',
    })
    @ApiStandardErrorResponses()
    async handleClickWebhook(@Body() payload: Record<string, string | number | null>) {
        return this.paymentsService.finalizeDepositIntent({
            payload,
            verified: this.paymentsService.verifyClickSignature(payload),
        });
    }

    @Post('deposit-intents/:id/reconcile')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.admin, UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Reconcile deposit intent',
        description: 'Admin reconcile for pending Click deposit intents.',
    })
    @ApiStandardErrorResponses()
    reconcileDepositIntent(@Param('id') id: string) {
        return this.paymentsService.reconcileDepositIntent(id);
    }

    @Post('withdraw-intents')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.publisher)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Create withdrawal intent',
        description: 'Create a Click withdrawal intent for the authenticated publisher.',
    })
    @ApiStandardErrorResponses()
    async createWithdrawalIntent(
        @Actor() actor: { id: string },
        @Body() dto: CreateWithdrawalIntentDto,
    ) {
        const amount = new Prisma.Decimal(dto.amount);
        return this.paymentsService.createWithdrawalIntent({
            userId: actor.id,
            amount,
            idempotencyKey: dto.idempotencyKey,
        });
    }

    @Post('withdraw/webhook')
    @ApiOperation({
        summary: 'Withdrawal webhook handler',
        description: 'Finalize Click withdrawals.',
    })
    @ApiStandardErrorResponses()
    async handleWithdrawalWebhook(@Body() payload: Record<string, string | number | null>) {
        return this.paymentsService.finalizeWithdrawalIntent({
            payload,
            verified: this.paymentsService.verifyClickSignature(payload),
        });
    }

    @Post('withdraw-intents/:id/reconcile')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.admin, UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Reconcile withdrawal intent',
        description: 'Admin reconcile for pending Click withdrawal intents.',
    })
    @ApiStandardErrorResponses()
    reconcileWithdrawalIntent(@Param('id') id: string) {
        return this.paymentsService.reconcileWithdrawalIntent(id);
    }
}