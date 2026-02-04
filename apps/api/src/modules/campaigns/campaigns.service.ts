import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CreateCreativeDto } from './dto/create-creative.dto';
import { CreateTargetDto } from './dto/create-target.dto';
import {
    AdCreative,
    Campaign,
    CampaignStatus,
    CampaignTarget,
    CampaignTargetStatus,
    ChannelStatus,
    Prisma,
} from '@prisma/client';
import { UserRole } from '@/modules/domain/contracts';
import { AuditService } from '@/modules/audit/audit.service';
import { assertCampaignTargetTransition, assertCampaignTransition } from '@/modules/lifecycle/lifecycle';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { CampaignConfig, campaignConfig } from '@/config/campaign.config';
import { ConfigType } from '@nestjs/config';
import { TransitionActor } from '@/modules/domain/contracts';

@Injectable()
export class CampaignsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
        @Inject(campaignConfig.KEY)
        private readonly campaignConfig: CampaignConfig
    ) { }

    private toDecimal(value: string) {
        try {
            return new Prisma.Decimal(value);
        } catch {
            throw new BadRequestException('Invalid decimal value');
        }
    }

    private mapCampaign(campaign: Campaign) {
        return sanitizeForJson({
            id: campaign.id,
            advertiserId: campaign.advertiserId,
            name: campaign.name,
            totalBudget: campaign.totalBudget,
            spentBudget: campaign.spentBudget,
            status: campaign.status,
            startAt: campaign.startAt,
            endAt: campaign.endAt,
            createdAt: campaign.createdAt,
        });
    }

    private mapCreative(creative: AdCreative) {
        return sanitizeForJson({
            id: creative.id,
            campaignId: creative.campaignId,
            contentType: creative.contentType,
            contentPayload: creative.contentPayload,
            approvedBy: creative.approvedBy,
            approvedAt: creative.approvedAt,
        });
    }

    private mapTarget(target: CampaignTarget) {
        return sanitizeForJson({
            id: target.id,
            campaignId: target.campaignId,
            channelId: target.channelId,
            price: target.price,
            scheduledAt: target.scheduledAt,
            status: target.status,
            moderatedBy: target.moderatedBy,
            moderatedAt: target.moderatedAt,
            moderationReason: target.moderationReason,
        });
    }

    async createCampaign(userId: string, dto: CreateCampaignDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, roleGrants: { select: { role: true } } },
        });

        const roles = user ? new Set([user.role, ...user.roleGrants.map((grant) => grant.role)]) : null;
        if (!roles || !roles.has(UserRole.advertiser)) {
            throw new BadRequestException('Only advertisers can create campaigns');
        }

        const totalBudget = this.toDecimal(dto.totalBudget);
        if (totalBudget.lte(0)) {
            throw new BadRequestException('Total budget must be positive');
        }

        const campaign = await this.prisma.campaign.create({
            data: {
                advertiserId: userId,
                name: dto.name,
                totalBudget,
                status: CampaignStatus.draft,
                startAt: dto.startAt ? new Date(dto.startAt) : null,
                endAt: dto.endAt ? new Date(dto.endAt) : null,
            },
        });

        await this.auditService.log({
            userId,
            action: 'campaign_created',
            metadata: { campaignId: campaign.id },
        });

        return this.mapCampaign(campaign);
    }

    async addCreative(campaignId: string, userId: string, dto: CreateCreativeDto) {
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, advertiserId: true },
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        if (campaign.advertiserId !== userId) {
            throw new BadRequestException('Not campaign owner');
        }

        const creative = await this.prisma.adCreative.create({
            data: {
                campaignId,
                contentType: dto.contentType,
                contentPayload: dto.contentPayload as Prisma.InputJsonValue,
            },
        });

        await this.auditService.log({
            userId,
            action: 'campaign_creative_added',
            metadata: { campaignId, creativeId: creative.id },
        });

        return this.mapCreative(creative);
    }

    async addTarget(campaignId: string, userId: string, dto: CreateTargetDto) {
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, advertiserId: true },
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        if (campaign.advertiserId !== userId) {
            throw new BadRequestException('Not campaign owner');
        }

        const channel = await this.prisma.channel.findUnique({
            where: { id: dto.channelId },
            select: { id: true, status: true },
        });

        if (!channel || channel.status !== ChannelStatus.approved) {
            throw new BadRequestException('Channel must be approved');
        }

        const price = this.toDecimal(dto.price);
        if (price.lte(0)) {
            throw new BadRequestException('Target price must be positive');
        }

        const target = await this.prisma.campaignTarget.create({
            data: {
                campaignId,
                channelId: dto.channelId,
                price,
                scheduledAt: new Date(dto.scheduledAt),
            },
        });

        await this.auditService.log({
            userId,
            action: 'campaign_target_added',
            metadata: { campaignId, targetId: target.id },
        });

        return this.mapTarget(target);
    }

    async activateCampaign(campaignId: string, userId: string) {
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, advertiserId: true, status: true, creatives: true, startAt: true, endAt: true },
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        if (campaign.advertiserId !== userId) {
            throw new BadRequestException('Not campaign owner');
        }

        if (campaign.status !== CampaignStatus.draft) {
            throw new BadRequestException(
                `Campaign cannot be activated from status ${campaign.status}`,
            );
        }

        if (!campaign.creatives || campaign.creatives.length === 0) {
            throw new BadRequestException('Campaign must have at least one creative');
        }

        // Validate dates if provided
        if (campaign.startAt && campaign.endAt) {
            if (campaign.startAt > campaign.endAt) {
                throw new BadRequestException('startAt must be before endAt');
            }
        }

        if (campaign.endAt && campaign.endAt <= new Date()) {
            throw new BadRequestException('endAt must be in the future');
        }

        assertCampaignTransition({
            campaignId,
            from: campaign.status,
            to: CampaignStatus.active,
            actor: TransitionActor.advertiser,
            correlationId: campaignId,
        });

        const updated = await this.prisma.campaign.update({
            where: { id: campaignId },
            data: {
                status: CampaignStatus.active,
            },
        });

        await this.auditService.log({
            userId,
            action: 'campaign_activated',
            metadata: { campaignId },
        });

        return this.mapCampaign(updated);
    }

    async submitTarget(campaignId: string, targetId: string, userId: string) {
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: {
                campaign: { include: { creatives: true } },
                channel: true,
            },
        });

        if (!target || target.campaignId !== campaignId) {
            throw new NotFoundException('Campaign target not found');
        }

        if (target.campaign.advertiserId !== userId) {
            throw new BadRequestException('Not campaign owner');
        }

        if (target.campaign.status !== CampaignStatus.active) {
            throw new BadRequestException(
                `Campaign must be active to submit targets (current status: ${target.campaign.status})`,
            );
        }

        if (target.status !== CampaignTargetStatus.pending) {
            throw new BadRequestException(
                `Target cannot be submitted from status ${target.status}`,
            );
        }

        if (!target.channel || target.channel.status !== ChannelStatus.approved) {
            throw new BadRequestException('Channel must be approved');
        }

        if (!target.campaign.creatives?.length) {
            throw new BadRequestException('Campaign has no creatives');
        }

        const minLeadMs = this.campaignConfig.minLeadMs;
        if (target.scheduledAt.getTime() < Date.now() + minLeadMs) {
            throw new BadRequestException('scheduledAt must be in the future');
        }

        assertCampaignTargetTransition({
            campaignTargetId: targetId,
            from: target.status,
            to: CampaignTargetStatus.submitted,
            actor: TransitionActor.advertiser,
            correlationId: targetId,
        });

        const updated = await this.prisma.campaignTarget.update({
            where: { id: targetId },
            data: {
                status: CampaignTargetStatus.submitted,
                moderatedBy: null,
                moderatedAt: null,
                moderationReason: null,
            },
        });

        await this.auditService.log({
            userId,
            action: 'campaign_target_submitted',
            metadata: { targetId },
        });

        return this.mapTarget(updated);
    }

    async acceptTargetAsDeal(targetId: string, publisherId: string) {
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: { channel: true },
        });

        if (!target) {
            throw new NotFoundException('Deal not found');
        }

        if (target.channel.ownerId !== publisherId) {
            throw new BadRequestException('Not channel owner');
        }

        if (target.status !== CampaignTargetStatus.submitted) {
            throw new BadRequestException(
                `Deal cannot be accepted from status ${target.status}`,
            );
        }

        assertCampaignTargetTransition({
            campaignTargetId: targetId,
            from: target.status,
            to: CampaignTargetStatus.accepted,
            actor: TransitionActor.publisher,
            correlationId: targetId,
        });

        const updated = await this.prisma.campaignTarget.update({
            where: { id: targetId },
            data: { status: CampaignTargetStatus.accepted },
        });

        await this.auditService.log({
            userId: publisherId,
            action: 'campaign_target_accepted',
            metadata: { targetId },
        });

        return this.mapTarget(updated);

    }

}