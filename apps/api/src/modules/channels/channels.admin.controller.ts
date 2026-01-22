import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { ChannelDecisionDto } from './dto/channel-decision.dto';

@Controller('admin/channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
export class ChannelsAdminController {
    constructor(private readonly channelsService: ChannelsService) {}

    @Post(':id/approve')
    approve(
        @Param('id') channelId: string,
        @Actor() actor: { id: string },
    ) {
        return this.channelsService.approveChannel(channelId, actor.id);
    }

    @Post(':id/reject')
    reject(
        @Param('id') channelId: string,
        @Actor() actor: { id: string },
        @Body() dto: ChannelDecisionDto,
    ) {
        return this.channelsService.rejectChannel(channelId, actor.id, dto.reason);
    }
}
