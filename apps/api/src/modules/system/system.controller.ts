import {
    Body,
    Controller,
    Post,
    Req,
} from '@nestjs/common';
import { SystemService } from './system.service';
import { ResolveEscrowDto } from './dto/resolve-escrow.dto';

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
}
