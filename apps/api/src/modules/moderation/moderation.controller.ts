import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Actor } from '@/modules/auth/decorators/actor.decorator';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import {
    ModerationApproveResponseDto,
    ModerationTargetDto,
} from './dto/moderation-response.dto';

@Controller('admin/moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
@ApiTags('Moderation')
@ApiBearerAuth()
export class ModerationController {
    constructor(private readonly moderationService: ModerationService) { }

    @Get('pending')
    @ApiOperation({
        summary: 'List pending moderation targets',
        description: 'List campaign targets pending moderation.',
    })
    @ApiOkResponse({ type: ModerationTargetDto, isArray: true })
    @ApiStandardErrorResponses()
    listPending() {
        return this.moderationService.listPending();
    }

    @Post(':targetId/approve')
    @ApiOperation({
        summary: 'Approve target',
        description: 'Approve a submitted campaign target.',
    })
    @ApiParam({
        name: 'targetId',
        description: 'Campaign target UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: ModerationApproveResponseDto })
    @ApiStandardErrorResponses()
    approve(
        @Param('targetId', new ParseUUIDPipe()) targetId: string,
        @Actor() actor: { id: string },
    ) {
        return this.moderationService.approve(targetId, actor.id);
    }

    @Post(':targetId/reject')
    @ApiOperation({
        summary: 'Reject target',
        description: 'Reject a submitted campaign target with an optional reason.',
    })
    @ApiParam({
        name: 'targetId',
        description: 'Campaign target UUID.',
        format: 'uuid',
    })
    @ApiOkResponse({ type: ModerationTargetDto })
    @ApiStandardErrorResponses()
    reject(
        @Param('targetId', new ParseUUIDPipe()) targetId: string,
        @Actor() actor: { id: string },
        @Body() dto: ModerationDecisionDto,
    ) {
        return this.moderationService.reject(targetId, actor.id, dto.reason);
    }
}