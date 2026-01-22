import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.publisher)
export class ChannelsController {
    constructor(private readonly channelsService: ChannelsService) { }

    @Post()
    createChannel(
        @Actor() actor: { id: string },
        @Body() dto: CreateChannelDto,
    ) {
        return this.channelsService.createChannel(actor.id, dto);
    }

    @Get('my')
    listMyChannels(@Actor() actor: { id: string }) {
        return this.channelsService.listMyChannels(actor.id);
    }

    @Post(':id/request-verification')
    requestVerification(
        @Param('id') channelId: string,
        @Actor() actor: { id: string },
    ) {
        return this.channelsService.requestVerification(channelId, actor.id);
    }
}