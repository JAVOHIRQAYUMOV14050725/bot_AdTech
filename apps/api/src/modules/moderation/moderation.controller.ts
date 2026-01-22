import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';

@Controller('admin/moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
export class ModerationController {
    constructor(private readonly moderationService: ModerationService) { }

    @Get('pending')
    listPending() {
        return this.moderationService.listPending();
    }

    @Post(':targetId/approve')
    approve(@Param('targetId') targetId: string, @Actor() actor: { id: string }) {
        return this.moderationService.approve(targetId, actor.id);
    }

    @Post(':targetId/reject')
    reject(
        @Param('targetId') targetId: string,
        @Actor() actor: { id: string },
        @Body() dto: ModerationDecisionDto,
    ) {
        return this.moderationService.reject(targetId, actor.id, dto.reason);
    }
}