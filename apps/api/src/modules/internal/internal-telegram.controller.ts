import { Body, Controller, Post, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalTokenGuard } from '@/common/guards/internal-token.guard';
import { AuthService } from '@/modules/auth/auth.service';
import { InternalTelegramStartDto } from './dto/internal-telegram-start.dto';
import { InternalTelegramEnsureDto } from './dto/internal-telegram-ensure.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { TransitionActor, UserRole } from '@/modules/domain/contracts';
import { InternalTelegramResolvePublisherDto } from './dto/internal-telegram-resolve-publisher.dto';
import { CampaignStatus, ChannelStatus, PostJobStatus } from '@prisma/client';
import { InternalTelegramAddealLookupDto } from './dto/internal-telegram-addeal-lookup.dto';
import { InternalTelegramVerifyChannelDto } from './dto/internal-telegram-verify-channel.dto';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { ChannelsService } from '@/modules/channels/channels.service';
import { assertCampaignTransition, assertPostJobTransition } from '@/modules/lifecycle/lifecycle';
import { InternalTelegramAdminForceDto } from './dto/internal-telegram-admin-force.dto';
import { InternalTelegramAdminPostDto } from './dto/internal-telegram-admin-post.dto';
import { InternalTelegramAdminCampaignDto } from './dto/internal-telegram-admin-campaign.dto';
import { normalizeTelegramUsername } from '@/common/utils/telegram-username.util';

@ApiTags('Internal')
@UseGuards(InternalTokenGuard)
@Controller('internal/telegram')
export class InternalTelegramController {
    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
        private readonly identityResolver: IdentityResolverService,
        private readonly telegramService: TelegramService,
        private readonly channelsService: ChannelsService,
    ) { }

    @Post('start')
    start(@Body() dto: InternalTelegramStartDto) {
        return this.authService.handleTelegramStart({
            telegramId: dto.telegramId,
            username: dto.username ?? null,
            startPayload: dto.startPayload ?? null,
            updateId: dto.updateId ?? null,
        });
    }

    @Post('advertiser/ensure')
    async ensureAdvertiser(@Body() dto: InternalTelegramEnsureDto) {
        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(dto.telegramId) },
        });

        if (!user) {
            throw new BadRequestException('Advertiser account not found');
        }

        if (user.role !== UserRole.advertiser) {
            throw new ForbiddenException(`Role mismatch: ${user.role}`);
        }

        return {
            user: {
                id: user.id,
                role: user.role,
                telegramId: user.telegramId?.toString() ?? null,
                username: user.username,
            },
        };
    }

    @Post('publisher/ensure')
    async ensurePublisher(@Body() dto: InternalTelegramEnsureDto) {
        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(dto.telegramId) },
        });

        if (!user) {
            throw new BadRequestException('Publisher account not found');
        }

        if (user.role !== UserRole.publisher) {
            throw new ForbiddenException(`Role mismatch: ${user.role}`);
        }

        return {
            user: {
                id: user.id,
                role: user.role,
                telegramId: user.telegramId?.toString() ?? null,
                username: user.username,
            },
        };
    }

    @Post('advertiser/resolve-publisher')
    async resolvePublisher(@Body() dto: InternalTelegramResolvePublisherDto) {
        const trimmed = dto.identifier.trim();
        const parsed = this.parsePublisherIdentifier(trimmed);
        if (!parsed) {
            return { ok: false as const, reason: 'Please send a valid @username or t.me link.' };
        }

        if ('error' in parsed) {
            return { ok: false as const, reason: parsed.error };
        }

        const username = parsed.username;

        const publisherByUsername = await this.prisma.user.findFirst({
            where: {
                username: { equals: username, mode: 'insensitive' },
            },
        });

        if (publisherByUsername) {
            if (publisherByUsername.role !== UserRole.publisher) {
                return {
                    ok: false as const,
                    reason: `@${publisherByUsername.username ?? username} is not registered as a publisher.`,
                };
            }
            return {
                ok: true as const,
                publisher: {
                    id: publisherByUsername.id,
                    telegramId: publisherByUsername.telegramId?.toString() ?? null,
                    username: publisherByUsername.username,
                },
                source: parsed.source,
            };
        }

        const channel = await this.prisma.channel.findFirst({
            where: {
                username: { equals: username, mode: 'insensitive' },
            },
            include: { owner: true },
        });

        if (channel) {
            if (channel.status !== ChannelStatus.approved) {
                return {
                    ok: false as const,
                    reason: `Channel ${channel.title} is not approved in the marketplace yet.`,
                };
            }
            if (channel.owner.role !== UserRole.publisher) {
                return {
                    ok: false as const,
                    reason: `Channel ${channel.title} is not owned by a publisher account.`,
                };
            }
            return {
                ok: true as const,
                publisher: {
                    id: channel.owner.id,
                    telegramId: channel.owner.telegramId?.toString() ?? null,
                    username: channel.owner.username,
                },
                source: parsed.source,
                channel: {
                    id: channel.id,
                    title: channel.title,
                    username: channel.username,
                },
            };
        }

        return {
            ok: false as const,
            reason: 'Publisher not found. Send a valid @username or a public channel/group link.',
        };
    }

    @Post('addeals/lookup')
    async lookupAdDeal(@Body() dto: InternalTelegramAddealLookupDto) {
        const adDeal = await this.prisma.adDeal.findUnique({
            where: { id: dto.adDealId },
            select: {
                id: true,
                advertiserId: true,
                publisherId: true,
                amount: true,
            },
        });

        if (!adDeal) {
            throw new BadRequestException('AdDeal not found');
        }

        return {
            adDeal: {
                id: adDeal.id,
                advertiserId: adDeal.advertiserId,
                publisherId: adDeal.publisherId,
                amount: adDeal.amount.toFixed(2),
            },
        };
    }

    @Post('publisher/verify-channel')
    async verifyChannel(@Body() dto: InternalTelegramVerifyChannelDto) {
        if (!dto.identifier) {
            throw new BadRequestException('Missing identifier');
        }

        const resolved = await this.identityResolver.resolveChannelIdentifier(dto.identifier, {
            actorId: dto.publisherId,
        });
        if (!resolved.ok) {
            return { ok: false as const, message: resolved.message };
        }

        const botAdmin = await this.telegramService.checkBotAdmin(
            resolved.value.telegramChannelId,
        );
        if (!botAdmin.isAdmin) {
            return {
                ok: false as const,
                message:
                    '⚠️ Please add @AdTechBot as an ADMIN to your channel, then try again.',
            };
        }

        const userAdmin = await this.telegramService.checkUserAdmin(
            resolved.value.telegramChannelId,
            Number(dto.telegramUserId),
        );
        if (!userAdmin.isAdmin) {
            return {
                ok: false as const,
                message:
                    '❌ Ownership check failed. You must be an ADMIN/OWNER of this channel.',
            };
        }

        return this.registerResolvedChannel({
            publisherId: dto.publisherId,
            telegramChannelId: resolved.value.telegramChannelId,
            title: resolved.value.title,
            username: resolved.value.username,
        });
    }

    @Post('publisher/verify-private-channel')
    async verifyPrivateChannel(@Body() dto: InternalTelegramVerifyChannelDto) {
        const resolved = await this.identityResolver.resolvePrivateChannelForUser({
            actorId: dto.publisherId,
            telegramUserId: Number(dto.telegramUserId),
        });

        if (!resolved.ok) {
            return { ok: false as const, message: resolved.message };
        }

        return this.registerResolvedChannel({
            publisherId: dto.publisherId,
            telegramChannelId: resolved.value.telegramChannelId,
            title: resolved.value.title,
            username: resolved.value.username,
        });
    }

    private async registerResolvedChannel(params: {
        publisherId: string;
        telegramChannelId: string;
        title: string;
        username?: string;
    }) {
        const { publisherId, telegramChannelId, title, username } = params;
        let parsedChannelId: bigint;
        try {
            parsedChannelId = BigInt(telegramChannelId);
        } catch {
            return { ok: false as const, message: '❌ Invalid channel identifier. Please try again.' };
        }

        const existing = await this.prisma.channel.findFirst({
            where: { telegramChannelId: parsedChannelId },
            include: { owner: true },
        });

        if (existing) {
            if (existing.ownerId === publisherId) {
                if (existing.status === ChannelStatus.approved) {
                    return { ok: true as const, message: '✅ This channel is already approved in your account.' };
                }
                return { ok: true as const, message: 'ℹ️ This channel is already registered and pending review.' };
            }

            return { ok: false as const, message: '❌ This channel is already registered by another publisher.' };
        }

        try {
            const channel = await this.channelsService.createChannelFromResolved({
                ownerId: publisherId,
                resolved: {
                    telegramChannelId,
                    title,
                    username,
                },
            });

            await this.channelsService.requestVerification(channel.id, publisherId);

            return {
                ok: true as const,
                message: '✅ Channel verified and registered!\n\nYour channel is now pending approval.',
            };
        } catch (err) {
            return {
                ok: false as const,
                message:
                    '❌ We could not complete verification.\n\n' +
                    'Please ensure @AdTechBot is ADMIN and try again.',
            };
        }
    }

    private parsePublisherIdentifier(value: string) {
        const usernameRegex = /^(?=.{5,32}$)(?=.*[A-Za-z])[A-Za-z0-9_]+$/;
        if (!value) {
            return null;
        }

        const linkMatch = value.match(/^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i);
        if (linkMatch) {
            const path = linkMatch[1];
            const lowered = path.toLowerCase();
            if (lowered === 'c' || lowered === 'joinchat' || path.startsWith('+')) {
                return {
                    error:
                        'Invite links cannot be used for publisher lookup. Please send a public @username or t.me/username.',
                };
            }
        }

        const normalized = normalizeTelegramUsername(value);
        if (!normalized) {
            return null;
        }

        if (!usernameRegex.test(normalized)) {
            return { error: 'That @username does not look valid.' };
        }

        return { username: normalized, source: linkMatch ? 'link' as const : 'username' as const };
    }

    @Post('admin/force-release')
    async forceRelease(@Body() dto: InternalTelegramAdminForceDto) {
        const admin = await this.assertAdmin(dto.telegramId);

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_release',
                metadata: {
                    campaignTargetId: dto.campaignTargetId,
                    status: 'queued_manual_review',
                    requestedVia: 'telegram',
                },
                ipAddress: 'telegram',
            },
        });

        return { ok: true };
    }

    @Post('admin/force-refund')
    async forceRefund(@Body() dto: InternalTelegramAdminForceDto) {
        const admin = await this.assertAdmin(dto.telegramId);

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'force_refund',
                metadata: {
                    campaignTargetId: dto.campaignTargetId,
                    reason: dto.reason ?? 'admin_force',
                    status: 'queued_manual_review',
                    requestedVia: 'telegram',
                },
                ipAddress: 'telegram',
            },
        });

        return { ok: true };
    }

    @Post('admin/retry-post')
    async retryPost(@Body() dto: InternalTelegramAdminPostDto) {
        const admin = await this.assertAdmin(dto.telegramId);

        const postJob = await this.prisma.postJob.findUnique({
            where: { id: dto.postJobId },
            select: { id: true, status: true },
        });

        if (!postJob) {
            throw new BadRequestException('PostJob not found');
        }

        const transition = assertPostJobTransition({
            postJobId: dto.postJobId,
            from: postJob.status,
            to: PostJobStatus.queued,
            actor: TransitionActor.admin,
            correlationId: dto.postJobId,
        });

        if (!transition.noop) {
            await this.prisma.postJob.update({
                where: { id: dto.postJobId },
                data: {
                    status: PostJobStatus.queued,
                    lastError: null,
                },
            });
        }

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'retry_post',
                metadata: { postJobId: dto.postJobId },
            },
        });

        return { ok: true };
    }

    @Post('admin/freeze-campaign')
    async freezeCampaign(@Body() dto: InternalTelegramAdminCampaignDto) {
        const admin = await this.assertAdmin(dto.telegramId);

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: dto.campaignId },
            select: { id: true, status: true },
        });

        if (!campaign) {
            throw new BadRequestException('Campaign not found');
        }

        const transition = assertCampaignTransition({
            campaignId: dto.campaignId,
            from: campaign.status,
            to: CampaignStatus.paused,
            actor: TransitionActor.admin,
            correlationId: dto.campaignId,
        });

        if (!transition.noop) {
            await this.prisma.campaign.update({
                where: { id: dto.campaignId },
                data: { status: CampaignStatus.paused },
            });
        }

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'freeze_campaign',
                metadata: { campaignId: dto.campaignId },
            },
        });

        return { ok: true };
    }

    @Post('admin/unfreeze-campaign')
    async unfreezeCampaign(@Body() dto: InternalTelegramAdminCampaignDto) {
        const admin = await this.assertAdmin(dto.telegramId);

        const campaign = await this.prisma.campaign.findUnique({
            where: { id: dto.campaignId },
            select: { id: true, status: true },
        });

        if (!campaign) {
            throw new BadRequestException('Campaign not found');
        }

        const transition = assertCampaignTransition({
            campaignId: dto.campaignId,
            from: campaign.status,
            to: CampaignStatus.active,
            actor: TransitionActor.admin,
            correlationId: dto.campaignId,
        });

        if (!transition.noop) {
            await this.prisma.campaign.update({
                where: { id: dto.campaignId },
                data: { status: CampaignStatus.active },
            });
        }

        await this.prisma.userAuditLog.create({
            data: {
                userId: admin.id,
                action: 'unfreeze_campaign',
                metadata: { campaignId: dto.campaignId },
            },
        });

        return { ok: true };
    }

    private async assertAdmin(telegramId: string) {
        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(telegramId) },
        });

        if (!user || user.role !== UserRole.super_admin) {
            throw new ForbiddenException('Admin only command');
        }

        return user;
    }
}
