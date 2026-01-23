import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { Channel, ChannelStatus, UserRole } from '@prisma/client';
import { VerificationService } from './verification.service';
import { AuditService } from '@/modules/audit/audit.service';
import { sanitizeForJson } from '@/common/serialization/sanitize';

@Injectable()
export class ChannelsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly verificationService: VerificationService,
        private readonly auditService: AuditService,
    ) { }

    private parseTelegramId(value: string): bigint {
        try {
            return BigInt(value);
        } catch {
            throw new BadRequestException('Invalid telegramChannelId');
        }
    }

    private mapChannel(channel: Channel) {
        return sanitizeForJson({
            id: channel.id,
            telegramChannelId: channel.telegramChannelId,
            title: channel.title,
            username: channel.username,
            category: channel.category,
            subscriberCount: channel.subscriberCount,
            avgViews: channel.avgViews,
            cpm: channel.cpm,
            status: channel.status,
            createdAt: channel.createdAt,
            deletedAt: channel.deletedAt,
            ownerId: channel.ownerId,
        });
    }

    async createChannel(userId: string, dto: CreateChannelDto) {
        const owner = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true },
        });

        if (!owner || owner.role !== UserRole.publisher) {
            throw new BadRequestException('Only publishers can create channels');
        }

        const telegramChannelId = this.parseTelegramId(dto.telegramChannelId);

        const channel = await this.prisma.channel.create({
            data: {
                telegramChannelId,
                title: dto.title,
                username: dto.username,
                ownerId: userId,
                status: ChannelStatus.pending,
            },
        });

        await this.auditService.log({
            userId,
            action: 'channel_created',
            metadata: {
                channelId: channel.id,
                telegramChannelId: dto.telegramChannelId,
            },
        });

        return this.mapChannel(channel);
    }

    async listMyChannels(userId: string) {
        const channels = await this.prisma.channel.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
        });

        return channels.map((channel) => this.mapChannel(channel));
    }

    async requestVerification(channelId: string, userId: string) {
        const channel = await this.prisma.channel.findUnique({
            where: { id: channelId },
        });

        if (!channel) {
            throw new NotFoundException('Channel not found');
        }

        if (channel.ownerId !== userId) {
            throw new BadRequestException('Not channel owner');
        }

        if (channel.status !== ChannelStatus.pending) {
            throw new BadRequestException('Channel not in pending state');
        }

        const verified = await this.verificationService.verifyChannel(channel);
        if (!verified) {
            throw new BadRequestException('Bot is not admin of channel');
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const verification = await tx.channelVerification.upsert({
                where: { channelId: channel.id },
                update: {
                    fraudScore: 0,
                    notes: 'auto_verified',
                },
                create: {
                    channelId: channel.id,
                    fraudScore: 0,
                    notes: 'auto_verified',
                },
            });

            const result = await tx.channel.update({
                where: { id: channel.id },
                data: { status: ChannelStatus.verified },
            });

            return { result, verification };
        });

        await this.auditService.log({
            userId,
            action: 'channel_verification_requested',
            metadata: {
                channelId: channel.id,
                status: updated.result.status,
            },
        });

        return this.mapChannel(updated.result);
    }

    async approveChannel(channelId: string, adminId: string) {
        const channel = await this.prisma.channel.findUnique({
            where: { id: channelId },
        });

        if (!channel) {
            throw new NotFoundException('Channel not found');
        }

        if (channel.status !== ChannelStatus.verified) {
            throw new BadRequestException('Channel not verified');
        }

        const updated = await this.prisma.channel.update({
            where: { id: channelId },
            data: { status: ChannelStatus.approved },
        });

        await this.auditService.log({
            userId: adminId,
            action: 'channel_approved',
            metadata: { channelId },
        });

        return this.mapChannel(updated);
    }

    async rejectChannel(channelId: string, adminId: string, reason?: string) {
        const channel = await this.prisma.channel.findUnique({
            where: { id: channelId },
        });

        if (!channel) {
            throw new NotFoundException('Channel not found');
        }

        const rejectableStatuses: ChannelStatus[] = [
            ChannelStatus.pending,
            ChannelStatus.verified,
        ];
        if (!rejectableStatuses.includes(channel.status)) {
            throw new BadRequestException('Channel cannot be rejected');
        }

        const updated = await this.prisma.channel.update({
            where: { id: channelId },
            data: { status: ChannelStatus.rejected },
        });

        await this.auditService.log({
            userId: adminId,
            action: 'channel_rejected',
            metadata: { channelId, reason: reason ?? null },
        });

        return this.mapChannel(updated);
    }
}
