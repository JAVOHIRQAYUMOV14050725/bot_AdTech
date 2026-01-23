import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
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
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { ChannelResponseDto } from './dto/channel-response.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.publisher)
@ApiTags('Channels')
@ApiBearerAuth()
export class ChannelsController {
    constructor(private readonly channelsService: ChannelsService) { }

    @Post()
    @ApiOperation({
        summary: 'Create channel',
        description: 'Create a new channel for the authenticated publisher.',
    })
    @ApiCreatedResponse({ type: ChannelResponseDto })
    @ApiStandardErrorResponses()
    createChannel(
        @Actor() actor: { id: string },
        @Body() dto: CreateChannelDto,
    ) {
        return this.channelsService.createChannel(actor.id, dto);
    }

    @Get('my')
    @ApiOperation({
        summary: 'List my channels',
        description: 'List channels owned by the authenticated publisher.',
    })
    @ApiOkResponse({ type: ChannelResponseDto, isArray: true })
    @ApiStandardErrorResponses()
    listMyChannels(@Actor() actor: { id: string }) {
        return this.channelsService.listMyChannels(actor.id);
    }

    @Post(':id/request-verification')
    @ApiOperation({
        summary: 'Request verification',
        description: 'Request verification for a pending channel.',
    })
    @ApiParam({
        name: 'id',
        description: 'Channel UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: ChannelResponseDto })
    @ApiStandardErrorResponses()
    requestVerification(
        @Param('id', new ParseUUIDPipe()) channelId: string,
        @Actor() actor: { id: string },
    ) {
        return this.channelsService.requestVerification(channelId, actor.id);
    }
}