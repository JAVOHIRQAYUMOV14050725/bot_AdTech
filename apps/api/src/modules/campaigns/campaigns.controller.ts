import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CreateCreativeDto } from './dto/create-creative.dto';
import { CreateTargetDto } from './dto/create-target.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.advertiser)
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Post()
    createCampaign(@Actor() actor: { id: string }, @Body() dto: CreateCampaignDto) {
        return this.campaignsService.createCampaign(actor.id, dto);
    }

    @Post(':id/creatives')
    addCreative(
        @Param('id') campaignId: string,
        @Actor() actor: { id: string },
        @Body() dto: CreateCreativeDto,
    ) {
        return this.campaignsService.addCreative(campaignId, actor.id, dto);
    }

    @Post(':id/targets')
    addTarget(
        @Param('id') campaignId: string,
        @Actor() actor: { id: string },
        @Body() dto: CreateTargetDto,
    ) {
        return this.campaignsService.addTarget(campaignId, actor.id, dto);
    }
}