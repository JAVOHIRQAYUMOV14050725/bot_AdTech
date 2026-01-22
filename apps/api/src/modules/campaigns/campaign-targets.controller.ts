import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';

@Controller('campaign-targets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.advertiser)
export class CampaignTargetsController {
    constructor(private readonly campaignsService: CampaignsService) {}

    @Post(':id/submit')
    submit(@Param('id') targetId: string, @Actor() actor: { id: string }) {
        return this.campaignsService.submitTarget(targetId, actor.id);
    }
}