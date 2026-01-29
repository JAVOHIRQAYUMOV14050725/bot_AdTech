import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
    Inject,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { AdminCreateChannelDto } from './dto/admin-create-channel.dto';
import { Channel, ChannelStatus, Prisma, UserRole } from '@prisma/client';
import { VerificationService } from './verification.service';
import { AuditService } from '@/modules/audit/audit.service';
import { sanitizeForJson } from '@/common/serialization/sanitize';
import { TELEGRAM_CHANNEL_ID_REGEX } from '@/common/validators/telegram-channel-id-string.decorator';
import { TelegramCheckReason, TelegramCheckResult } from '@/modules/telegram/telegram.types';
import { appConfig } from '@/config/app.config';
import { ConfigType } from '@nestjs/config';

type Actor = { id: string; role: UserRole };

@Injectable()
export class ChannelsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly verificationService: VerificationService,
        private readonly auditService: AuditService,
        @Inject(appConfig.KEY)
        private readonly appConfig: ConfigType<typeof appConfig>,
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
        if (value == null) return undefined;

        let d: Prisma.Decimal;
        try {
            d = new Prisma.Decimal(value);
        } catch {
            throw new BadRequestException('Invalid cpm');
        }

        if (d.lte(0)) throw new BadRequestException('cpm must be positive');

        return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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

    private assertOwner(channel: Channel, actorId: string) {
        if (channel.ownerId !== actorId) {
            throw new ForbiddenException('Not channel owner');
        }
    }

    private assertDebugEnabledOr404() {
        if (this.appConfig.nodeEnv === 'production' && !this.appConfig.enableDebug) {
            throw new NotFoundException('Not Found');
        }
    }


    private async getChannelOr404(channelId: string): Promise<Channel> {
        const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) throw new NotFoundException('Channel not found');
        return channel;
    }

    private async getUserOr404(userId: string, select?: Prisma.UserSelect) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: (select ?? { id: true, role: true }) as any,
        });
        if (!user) throw new NotFoundException('User not found');
        return user as any;
    }


    async createChannel(userId: string, dto: CreateChannelDto) {

        await this.getUserOr404(userId, { id: true });

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
                throw new ConflictException('Channel already exists with this telegramChannelId');
            }
            throw e;
        }
    }


    async createChannelForOwner(actor: Actor, dto: AdminCreateChannelDto) {
        if (actor.role !== UserRole.admin && actor.role !== UserRole.super_admin) {
            throw new ForbiddenException('Only admin or super_admin can create channel for owner');
        }

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

        if (!owner) throw new NotFoundException('Owner not found');
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
                userId: actor.id,
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
        await this.getUserOr404(userId, { id: true });

        const channels = await this.prisma.channel.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
        });

        return channels.map((c) => this.mapChannel(c));
    }


    async requestVerification(channelId: string, userId: string) {
        const channel = await this.getChannelOr404(channelId);

        this.assertOwner(channel, userId);

        if (channel.status !== ChannelStatus.pending) {
            throw new BadRequestException('Channel not in pending state');
        }

        let checkResult: TelegramCheckResult;

        try {
            checkResult = await this.verificationService.verifyChannel(channel);
        } catch (err) {
            const payload = {
                reason: 'NETWORK',
                message: err instanceof Error ? err.message : String(err),
                name: err instanceof Error ? err.name : null,
            };

            // store last error for ops
            await this.prisma.channelVerification.upsert({
                where: { channelId },
                update: {
                    lastError: JSON.stringify(payload),
                    checkedAt: new Date(),
                    notes: 'telegram_network_error',
                },
                create: {
                    channelId,
                    fraudScore: 0,
                    notes: 'telegram_network_error',
                    lastError: JSON.stringify(payload),
                    checkedAt: new Date(),
                },
            });

            throw new ServiceUnavailableException('Telegram unavailable. Retry later.');
        }

        if (!checkResult.isAdmin) {
            const payload = {
                reason: checkResult.reason,
                telegramError: checkResult.telegramError ?? null,
                canAccessChat: checkResult.canAccessChat,
            };

            await this.prisma.channelVerification.upsert({
                where: { channelId },
                update: {
                    lastError: JSON.stringify(payload),
                    checkedAt: new Date(),
                    notes: 'verification_failed',
                },
                create: {
                    channelId,
                    fraudScore: 0,
                    notes: 'verification_failed',
                    lastError: JSON.stringify(payload),
                    checkedAt: new Date(),
                },
            });


            throw new BadRequestException('Channel verification failed');
        }

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


    async verifyChannelDebug(channelId: string, actor: Actor) {
        this.assertDebugEnabledOr404();

        // Optional: double-defense (controller should enforce)
        if (actor.role !== UserRole.super_admin) {
            throw new NotFoundException('Not Found');
        }

        const channel = await this.getChannelOr404(channelId);

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
        const channel = await this.getChannelOr404(channelId);

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
        const channel = await this.getChannelOr404(channelId);

        const rejectable: ChannelStatus[] = [ChannelStatus.pending, ChannelStatus.verified];

        if (!rejectable.includes(channel.status)) {
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
