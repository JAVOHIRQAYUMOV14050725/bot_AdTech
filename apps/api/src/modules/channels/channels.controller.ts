    import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
    import {
        ApiBearerAuth,
        ApiBadRequestResponse,
        ApiCreatedResponse,
        ApiNotFoundResponse,
        ApiOkResponse,
        ApiOperation,
        ApiParam,
        ApiServiceUnavailableResponse,
        ApiTags,
    } from '@nestjs/swagger';
    import { ChannelsService } from './channels.service';
    import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
    import { RolesGuard } from '@/modules/auth/guards/roles.guard';
    import { Roles } from '@/modules/auth/decorators/roles.decorator';
    import { UserRole } from '@/modules/domain/contracts';
    import { Actor } from '@/modules/auth/decorators/actor.decorator';
    import { CreateChannelDto } from './dto/create-channel.dto';
    import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
    import { ChannelResponseDto } from './dto/channel-response.dto';
    import { ApiErrorResponseDto } from '@/common/swagger/api-error-response.dto';
    import { ChannelVerifyDebugResponseDto } from './dto/channel-verify-debug-response.dto';

    @Controller('channels')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @ApiTags('Channels (publisher)')
    @ApiBearerAuth()
    export class ChannelsController {
        constructor(private readonly channelsService: ChannelsService) { }

        @Post()
        @Roles(UserRole.publisher)
        @ApiOperation({
            summary: 'Publisher-only: create a channel for the authenticated publisher',
            description: 'Publisher-only endpoint. Admins should use /api/admin/channels for ops.',
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
        @Roles(UserRole.publisher)
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
        @Roles(UserRole.publisher)
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
        @ApiBadRequestResponse({
            description: 'Bad Request (invalid channel or Telegram setup)',
            type: ApiErrorResponseDto,
            schema: {
                examples: {
                    invalidTelegramChannelId: {
                        summary: 'Invalid telegramChannelId format',
                        value: {
                            statusCode: 400,
                            timestamp: '2024-01-01T00:00:00.000Z',
                            path: '/api/channels/uuid/request-verification',
                            correlationId: 'c0a8012e-4c5b-4c4f-8f3d-1234567890ab',
                            error: {
                                message: 'Validation failed',
                                details: [
                                    {
                                        field: 'telegramChannelId',
                                        constraints: {
                                            isTelegramChannelIdString:
                                                'telegramChannelId must start with -100 and contain at least 5 digits',
                                        },
                                        value: 'channel_handle',
                                    },
                                ],
                            },
                        },
                    },
                    chatNotFound: {
                        summary: 'Telegram chat not found or bot has no access',
                        value: {
                            statusCode: 400,
                            timestamp: '2024-01-01T00:00:00.000Z',
                            path: '/api/channels/uuid/request-verification',
                            correlationId: 'c0a8012e-4c5b-4c4f-8f3d-1234567890ab',
                            error: {
                                message:
                                    'Telegram channel not found or bot has no access. Add bot to the channel (as admin) and use correct -100... id.',
                                details: {
                                    telegramChannelId: '-1001987654321',
                                    hintSteps: [
                                        'Ensure telegramChannelId is the REAL channel id in the format -100...',
                                        'Add the bot to the channel',
                                        'Promote the bot to Administrator',
                                        'Post a test message to the channel',
                                        'Confirm bot receives a channel_post update; copy channel_post.chat.id as telegramChannelId',
                                    ],
                                    telegramError: 'Bad Request: chat not found',
                                },
                            },
                        },
                    },
                    botNotAdmin: {
                        summary: 'Bot is not admin',
                        value: {
                            statusCode: 400,
                            timestamp: '2024-01-01T00:00:00.000Z',
                            path: '/api/channels/uuid/request-verification',
                            correlationId: 'c0a8012e-4c5b-4c4f-8f3d-1234567890ab',
                            error: {
                                message: 'Bot is not admin of channel',
                                details: {
                                    telegramChannelId: '-1001987654321',
                                    requiredPermissions: [
                                        'can_manage_chat',
                                        'can_post_messages',
                                        'can_edit_messages',
                                        'can_delete_messages',
                                    ],
                                    telegramError: 'Forbidden: not enough rights to get admin list',
                                },
                            },
                        },
                    },
                },
            }
        
        })
        @ApiServiceUnavailableResponse({
            description: 'Telegram rate limit or network error',
            type: ApiErrorResponseDto,
            schema: {
                example: {
                    statusCode: 503,
                    timestamp: '2024-01-01T00:00:00.000Z',
                    path: '/api/channels/uuid/request-verification',
                    correlationId: 'c0a8012e-4c5b-4c4f-8f3d-1234567890ab',
                    error: {
                        message: 'Telegram unavailable or rate-limited. Retry later.',
                        details: {
                            retryAfterSeconds: 30,
                            telegramError: 'Too Many Requests: retry after 30',
                        },
                    },
                },
            },
        })
        @ApiStandardErrorResponses()
        requestVerification(
            @Param('id', new ParseUUIDPipe()) channelId: string,
            @Actor() actor: { id: string },
        ) {
            return this.channelsService.requestVerification(channelId, actor.id);
        }

        @Get(':id/verify-debug')
        @Roles(UserRole.super_admin)
        @ApiOperation({
            summary: 'Debug Telegram verification (dev-only)',
            description:
                'Returns Telegram access/admin diagnostics. Enabled only when NODE_ENV != production or ENABLE_DEBUG=true.',
        })
        @ApiParam({
            name: 'id',
            description: 'Channel UUID.',
            format: 'uuid',
        })
        @ApiOkResponse({ type: ChannelVerifyDebugResponseDto })
        @ApiNotFoundResponse({
            description: 'Debug endpoint disabled or channel not found',
            type: ApiErrorResponseDto,
        })
        @ApiStandardErrorResponses()
        verifyDebug(
            @Param('id', new ParseUUIDPipe()) channelId: string,
            @Actor() actor: { id: string; role: UserRole },
        ) {
            return this.channelsService.verifyChannelDebug(channelId, actor);
        }
    }
