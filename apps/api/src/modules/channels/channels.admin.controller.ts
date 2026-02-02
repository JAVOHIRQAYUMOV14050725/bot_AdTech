import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@/modules/domain/contracts';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { ChannelDecisionDto } from './dto/channel-decision.dto';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { AdminCreateChannelDto } from './dto/admin-create-channel.dto';

@Controller('admin/channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
@ApiTags('AdminChannels (admin/super_admin)')
@ApiBearerAuth()
export class ChannelsAdminController {
    constructor(private readonly channelsService: ChannelsService) { }

    @Post()
    @ApiOperation({
        summary: 'Admin-only: create channel for a publisher (ops)',
        description: 'Create a new channel for a publisher by ownerId or ownerTelegramId.',
    })
    @ApiCreatedResponse({ type: ChannelResponseDto })
    @ApiStandardErrorResponses()
    createForPublisher(
        @Actor() actor: { id: string, role: UserRole },
        @Body() dto: AdminCreateChannelDto,
    ) {
        return this.channelsService.createChannelForOwner(actor, dto);
    }

    @Post(':id/approve')
    @ApiOperation({
        summary: 'Approve channel',
        description: 'Approve a verified channel.',
    })
    @ApiParam({
        name: 'id',
        description: 'Channel UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: ChannelResponseDto })
    @ApiStandardErrorResponses()
    approve(
        @Param('id', new ParseUUIDPipe()) channelId: string,
        @Actor() actor: { id: string },
    ) {
        return this.channelsService.approveChannel(channelId, actor.id);
    }

    @Post(':id/reject')
    @ApiOperation({
        summary: 'Reject channel',
        description: 'Reject a pending or verified channel with an optional reason.',
    })
    @ApiParam({
        name: 'id',
        description: 'Channel UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: ChannelResponseDto })
    @ApiStandardErrorResponses()
    reject(
        @Param('id', new ParseUUIDPipe()) channelId: string,
        @Actor() actor: { id: string },
        @Body() dto: ChannelDecisionDto,
    ) {
        return this.channelsService.rejectChannel(channelId, actor.id, dto.reason);
    }
}
