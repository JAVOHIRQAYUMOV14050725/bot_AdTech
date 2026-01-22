import {
    Body,
    Controller,
    Post,
    UseGuards,
} from '@nestjs/common';
import { SystemService } from './system.service';
import { ResolveEscrowDto } from './dto/resolve-escrow.dto';
import { KillSwitchDto } from './dto/kill-switch.dto';
import { ReconciliationDto, ReconciliationMode } from './dto/reconciliation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '../auth/decorators/actor.decorator';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin)
export class SystemController {
    constructor(private readonly systemService: SystemService) { }

    /**
     * 🔥 FORCE ESCROW RESOLUTION
     * POST /system/resolve-escrow
     */
    @Post('resolve-escrow')
    async resolveEscrow(
        @Body() dto: ResolveEscrowDto,
        @Actor() actor: { id: string },
    ) {
        // req.user.id → SessionGuard’dan keladi
        return this.systemService.resolveEscrow(
            dto.campaignTargetId,
            dto.action,
            dto.reason,
            actor.id,
        );
    }

    /**
     * 🔥 RUNTIME KILL SWITCH UPDATE
     * POST /system/kill-switch
     */
    @Post('kill-switch')
    async updateKillSwitch(
        @Body() dto: KillSwitchDto,
        @Actor() actor: { id: string },
    ) {
        return this.systemService.updateKillSwitch({
            key: dto.key,
            enabled: dto.enabled,
            reason: dto.reason,
            actorUserId: actor.id,
        });
    }

    /**
     * 🔍 REVENUE RECONCILIATION
     * POST /system/reconcile
     */
    @Post('reconcile')
    async reconcile(
        @Body() dto: ReconciliationDto,
        @Actor() actor: { id: string },
    ) {
        return this.systemService.runRevenueReconciliation({
            mode: dto.mode ?? ReconciliationMode.DRY_RUN,
            actorUserId: actor.id,
            correlationId: dto.correlationId,
        });
    }
}
