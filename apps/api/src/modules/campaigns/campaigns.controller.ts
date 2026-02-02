import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@/modules/domain/contracts';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CreateCreativeDto } from './dto/create-creative.dto';
import { CreateTargetDto } from './dto/create-target.dto';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import {
    CampaignResponseDto,
    CreativeResponseDto,
    TargetResponseDto,
} from './dto/campaign-response.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('Campaigns')
@ApiBearerAuth()
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Post()
    @Roles(UserRole.advertiser)
    @ApiOperation({
        summary: 'Create campaign',
        description: 'Create a new campaign for the authenticated advertiser.',
    })
    @ApiCreatedResponse({ type: CampaignResponseDto })
    @ApiStandardErrorResponses()
    createCampaign(@Actor() actor: { id: string }, @Body() dto: CreateCampaignDto) {
        return this.campaignsService.createCampaign(actor.id, dto);
    }

    @Post(':id/creatives')
    @Roles(UserRole.advertiser)
    @ApiOperation({
        summary: 'Add creative',
        description: 'Attach a creative to a campaign.',
    })
    @ApiParam({
        name: 'id',
        description: 'Campaign UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: CreativeResponseDto })
    @ApiStandardErrorResponses()
    addCreative(
        @Param('id', new ParseUUIDPipe()) campaignId: string,
        @Actor() actor: { id: string },
        @Body() dto: CreateCreativeDto,
    ) {
        return this.campaignsService.addCreative(campaignId, actor.id, dto);
    }

    @Post(':id/targets')
    @Roles(UserRole.advertiser)
    @ApiOperation({
        summary: 'Add target',
        description: 'Add a channel target to a campaign.',
    })
    @ApiParam({
        name: 'id',
        description: 'Campaign UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: TargetResponseDto })
    @ApiStandardErrorResponses()
    addTarget(
        @Param('id', new ParseUUIDPipe()) campaignId: string,
        @Actor() actor: { id: string },
        @Body() dto: CreateTargetDto,
    ) {
        return this.campaignsService.addTarget(campaignId, actor.id, dto);
    }

    @Post(':id/activate')
    @Roles(UserRole.advertiser)
    @ApiOperation({
        summary: 'Activate campaign',
        description: 'Transition campaign from draft to active status. Required before submitting targets.',
    })
    @ApiParam({
        name: 'id',
        description: 'Campaign UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: CampaignResponseDto })
    @ApiStandardErrorResponses()
    activateCampaign(
        @Param('id', new ParseUUIDPipe()) campaignId: string,
        @Actor() actor: { id: string },
    ) {
        return this.campaignsService.activateCampaign(campaignId, actor.id);
    }

    @Post(':campaignId/targets/:targetId/submit')
    @Roles(UserRole.advertiser)
    @ApiOperation({
        summary: 'Submit target',
        description: 'Submit a campaign target for moderation. Campaign must be active.',
    })
    @ApiParam({
        name: 'campaignId',
        description: 'Campaign UUID.',
        format: 'uuid',
    })
    @ApiParam({
        name: 'targetId',
        description: 'Campaign target UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: TargetResponseDto })
    @ApiStandardErrorResponses()
    submitTarget(
        @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
        @Param('targetId', new ParseUUIDPipe()) targetId: string,
        @Actor() actor: { id: string },
    ) {
        return this.campaignsService.submitTarget(campaignId, targetId, actor.id);
    }
}
