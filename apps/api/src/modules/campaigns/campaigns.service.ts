import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    UserRole,
} from '@prisma/client';
import { AuditService } from '@/modules/audit/audit.service';
import { assertCampaignTargetTransition } from '@/modules/lifecycle/lifecycle';
import { sanitizeForJson } from '@/common/serialization/sanitize';

@Injectable()
export class CampaignsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
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
            select: { role: true },
        });

        if (!user || user.role !== UserRole.advertiser) {
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

    async submitTarget(targetId: string, userId: string) {
        const target = await this.prisma.campaignTarget.findUnique({
            where: { id: targetId },
            include: { campaign: true },
        });

        if (!target) {
            throw new NotFoundException('Campaign target not found');
        }

        if (target.campaign.advertiserId !== userId) {
            throw new BadRequestException('Not campaign owner');
        }

        const transition = assertCampaignTargetTransition({
            campaignTargetId: targetId,
            from: target.status,
            to: CampaignTargetStatus.submitted,
            actor: 'advertiser',
            correlationId: targetId,
        });

        if (!transition.noop) {
            await this.prisma.campaignTarget.update({
                where: { id: targetId },
                data: { status: CampaignTargetStatus.submitted },
            });
        }

        await this.auditService.log({
            userId,
            action: 'campaign_target_submitted',
            metadata: { targetId },
        });

        return { ok: true, targetId };
    }
}
