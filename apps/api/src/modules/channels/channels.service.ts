import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { AdminCreateChannelDto } from './dto/admin-create-channel.dto';
import { Channel, ChannelStatus, Prisma, UserRole } from '@prisma/client';
import { VerificationService } from './verification.service';
import { AuditService } from '@/modules/audit/audit.service';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { TELEGRAM_CHANNEL_ID_REGEX } from '@/common/validators/telegram-channel-id-string.decorator';
import { TelegramAdminPermission, TelegramCheckReason } from '@/modules/telegram/telegram.types';
@Injectable()
export class ChannelsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly verificationService: VerificationService,
        private readonly auditService: AuditService,
    ) { }

    private parseTelegramId(value: string): bigint {
        if (!TELEGRAM_CHANNEL_ID_REGEX.test(value)) {
            throw new BadRequestException('Invalid telegramChannelId');
        }

        try {
            return BigInt(value);
        } catch {
            throw new BadRequestException('Invalid telegramChannelId');
        }
    }

    private parseTelegramUserId(value: string): bigint {
        if (!/^\d+$/.test(value)) {
            throw new BadRequestException('Invalid ownerTelegramId');
        }

        try {
            return BigInt(value);
        } catch {
            throw new BadRequestException('Invalid ownerTelegramId');
        }
    }

    private parseCpm(value?: string): Prisma.Decimal | undefined {
        if (value === undefined) {
            return undefined;
        }

        const decimal = new Prisma.Decimal(value);
        if (decimal.isNeg()) {
            throw new BadRequestException('cpm must be positive');
        }

        return decimal;
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
        const cpm = this.parseCpm(dto.cpm);

        try {
            const channel = await this.prisma.channel.create({
                data: {
                    telegramChannelId,
                    title: dto.title,
                    username: dto.username,
                    ownerId: userId,
                    status: ChannelStatus.pending,
                    cpm,
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
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                // unique violation
                throw new ConflictException('Channel already exists with this telegramChannelId');
            }
            throw e;
        }
    }

    async createChannelForOwner(adminId: string, dto: AdminCreateChannelDto) {
        if (dto.ownerId && dto.ownerTelegramId) {
            throw new BadRequestException('Provide either ownerId or ownerTelegramId');
        }

        if (!dto.ownerId && !dto.ownerTelegramId) {
            throw new BadRequestException('Owner is required');
        }

        const owner = dto.ownerId
            ? await this.prisma.user.findUnique({
                where: { id: dto.ownerId },
                select: { id: true, role: true },
            })
            : await this.prisma.user.findUnique({
                where: { telegramId: this.parseTelegramUserId(dto.ownerTelegramId!) },
                select: { id: true, role: true },
            });

        if (!owner) {
            throw new NotFoundException('Owner not found');
        }

        if (owner.role !== UserRole.publisher) {
            throw new BadRequestException('Owner must be a publisher');
        }

        const telegramChannelId = this.parseTelegramId(dto.telegramChannelId);

        try {
            const channel = await this.prisma.channel.create({
                data: {
                    telegramChannelId,
                    title: dto.title,
                    username: dto.username,
                    ownerId: owner.id,
                    status: ChannelStatus.pending,
                },
            });

            await this.auditService.log({
                userId: adminId,
                action: 'admin_channel_created',
                metadata: {
                    channelId: channel.id,
                    ownerId: owner.id,
                    telegramChannelId: dto.telegramChannelId,
                },
            });

            return this.mapChannel(channel);
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException('Channel already exists with this telegramChannelId');
            }
            throw e;
        }
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

        if (!channel) throw new NotFoundException('Channel not found');
        if (channel.ownerId !== userId) throw new BadRequestException('Not channel owner');
        if (channel.status !== ChannelStatus.pending)
            throw new BadRequestException('Channel not in pending state');

        let checkResult;
        try {
            checkResult = await this.verificationService.verifyChannel(channel);
        } catch (err) {
            // 🔴 Telegram / network error — LEKIN DBga YOZAMIZ
            await this.prisma.channelVerification.upsert({
                where: { channelId },
                update: {
                    lastError: JSON.stringify({
                        reason: 'NETWORK',
                        error: String(err),
                    }),
                    checkedAt: new Date(),
                    notes: 'telegram_network_error',
                },
                create: {
                    channelId,
                    fraudScore: 0,
                    notes: 'telegram_network_error',
                    lastError: JSON.stringify({
                        reason: 'NETWORK',
                        error: String(err),
                    }),
                    checkedAt: new Date(),
                },
            });

            throw new ServiceUnavailableException(
                'Telegram unavailable. Retry later.',
            );
        }

        if (!checkResult.isAdmin) {
            // ❌ Verification failed — BOT admin emas / chat topilmadi
            await this.prisma.channelVerification.upsert({
                where: { channelId },
                update: {
                    lastError: JSON.stringify({
                        reason: checkResult.reason,
                        telegramError: checkResult.telegramError ?? null,
                    }),
                    checkedAt: new Date(),
                    notes: 'verification_failed',
                },
                create: {
                    channelId,
                    fraudScore: 0,
                    notes: 'verification_failed',
                    lastError: JSON.stringify({
                        reason: checkResult.reason,
                        telegramError: checkResult.telegramError ?? null,
                    }),
                    checkedAt: new Date(),
                },
            });

            throw new BadRequestException('Channel verification failed');
        }

        // ✅ SUCCESS — auto verified
        const updated = await this.prisma.$transaction(async (tx) => {
            await tx.channelVerification.upsert({
                where: { channelId },
                update: {
                    lastError: null,
                    checkedAt: new Date(),
                    notes: 'auto_verified',
                },
                create: {
                    channelId,
                    fraudScore: 0,
                    notes: 'auto_verified',
                    checkedAt: new Date(),
                },
            });

            return tx.channel.update({
                where: { id: channelId },
                data: { status: ChannelStatus.verified },
            });
        });

        return this.mapChannel(updated);
    }




    async verifyChannelDebug(channelId: string, actor: { id: string; role: UserRole }) {
        if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG !== 'true') {
            throw new NotFoundException('Not Found');
        }

        const channel = await this.prisma.channel.findUnique({
            where: { id: channelId },
        });

        if (!channel) {
            throw new NotFoundException('Channel not found');
        }

        if (
            actor.role === UserRole.publisher
            && channel.ownerId !== actor.id
        ) {
            throw new ForbiddenException('Not channel owner');
        }

        const checkResult = await this.verificationService.verifyChannel(channel);

        return sanitizeForJson({
            channelId: channel.id,
            telegramChannelId: channel.telegramChannelId,
            canAccessChat: checkResult.canAccessChat,
            isAdmin: checkResult.isAdmin,
            reason: checkResult.reason,
            telegramError: checkResult.telegramError,
            retryAfterSeconds: checkResult.retryAfterSeconds ?? null,
        });
    }

    async approveChannel(channelId: string, adminId: string) {
        const channel = await this.prisma.channel.findUnique({
            where: { id: channelId },
        });

        if (!channel) {
            throw new NotFoundException('Channel not found');
        }
        if (channel.status === ChannelStatus.approved) {
            return this.mapChannel(channel);
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