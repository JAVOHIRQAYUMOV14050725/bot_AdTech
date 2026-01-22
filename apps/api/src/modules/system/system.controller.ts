import {
    Body,
    Controller,
    Post,
    Req,
} from '@nestjs/common';
import { SystemService } from './system.service';
import { ResolveEscrowDto } from './dto/resolve-escrow.dto';
import { KillSwitchDto } from './dto/kill-switch.dto';
import { ReconciliationDto, ReconciliationMode } from './dto/reconciliation.dto';

@Controller('system')
export class SystemController {
    constructor(private readonly systemService: SystemService) { }

    /**
     * 🔥 FORCE ESCROW RESOLUTION
     * POST /system/resolve-escrow
     */
    @Post('resolve-escrow')
    async resolveEscrow(
        @Body() dto: ResolveEscrowDto,
        @Req() req: any,
    ) {
        // req.user.id → SessionGuard’dan keladi
        return this.systemService.resolveEscrow(
            dto.campaignTargetId,
            dto.action,
            dto.reason,
            req.user.id,
        );
    }

    /**
     * 🔥 RUNTIME KILL SWITCH UPDATE
     * POST /system/kill-switch
     */
    @Post('kill-switch')
    async updateKillSwitch(
        @Body() dto: KillSwitchDto,
        @Req() req: any,
    ) {
        return this.systemService.updateKillSwitch({
            key: dto.key,
            enabled: dto.enabled,
            reason: dto.reason,
            actorUserId: req.user.id,
        });
    }

    /**
     * 🔍 REVENUE RECONCILIATION
     * POST /system/reconcile
     */
    @Post('reconcile')
    async reconcile(
        @Body() dto: ReconciliationDto,
        @Req() req: any,
    ) {
        return this.systemService.runRevenueReconciliation({
            mode: dto.mode ?? ReconciliationMode.DRY_RUN,
            actorUserId: req.user?.id,
            correlationId: dto.correlationId,
        });
    }
}
