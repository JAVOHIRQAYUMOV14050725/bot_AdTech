// handlers/start.handler.ts
import { Update, Start, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { PrismaService } from '@/prisma/prisma.service';
import { UserRole } from '@/modules/domain/contracts';
import { UserStatus } from '@prisma/client';
import { advertiserHome, publisherHome } from '../keyboards';

@Update()
export class StartHandler {
    private readonly logger = new Logger(StartHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
    ) { }

    @Start()
    async start(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const username = ctx.from?.username ?? null;

        const existing = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(userId) },
            select: { id: true, role: true },
        });

        if (existing) {
            if (existing.role === UserRole.publisher) {
                await this.fsm.set(userId, 'publisher', TelegramState.PUB_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: existing.id,
                    telegramUserId: userId,
                    role: existing.role,
                });
                await ctx.reply(
                    `✅ Welcome back!\n\n📢 Publisher Panel\n\n📈 Earnings: $0\n📣 Channels: 0`,
                    publisherHome,
                );
                return;
            }

            if (existing.role === UserRole.advertiser) {
                await this.fsm.set(userId, 'advertiser', TelegramState.ADV_DASHBOARD);
                this.logger.log({
                    event: 'user_state_recovered',
                    userId: existing.id,
                    telegramUserId: userId,
                    role: existing.role,
                });
                await ctx.reply(
                    `✅ Welcome back!\n\n🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
                    advertiserHome,
                );
                return;
            }

            await this.fsm.set(userId, 'admin', TelegramState.ADMIN_PANEL);
            this.logger.log({
                event: 'user_state_recovered',
                userId: existing.id,
                telegramUserId: userId,
                role: existing.role,
            });
            await ctx.reply('✅ Welcome back! Admin mode enabled.');
            return;
        }

        const created = await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    telegramId: BigInt(userId),
                    username,
                    role: UserRole.advertiser,
                    status: UserStatus.active,
                },
                select: { id: true, role: true },
            });

            await tx.wallet.create({
                data: { userId: user.id, balance: 0, currency: 'USD' },
            });

            await tx.userAuditLog.create({
                data: {
                    userId: user.id,
                    action: 'user_created_from_telegram',
                    metadata: { role: user.role },
                },
            });

            return user;
        });

        await this.fsm.set(userId, 'advertiser', TelegramState.ADV_DASHBOARD);
        this.logger.log({
            event: 'user_created_from_telegram',
            userId: created.id,
            telegramUserId: userId,
            role: created.role,
        });

        await ctx.reply(
            `👋 Welcome to AdTech!\n\n🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
            advertiserHome,
        );
    }
}