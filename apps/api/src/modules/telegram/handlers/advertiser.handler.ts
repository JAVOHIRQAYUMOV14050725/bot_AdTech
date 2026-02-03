import { Action, On, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramFSMService } from '../../application/telegram/telegram-fsm.service';
import { TelegramState } from '../../application/telegram/telegram-fsm.types';
import { advertiserHome } from '../keyboards';
import { PrismaService } from '@/prisma/prisma.service';
import { ChannelStatus, Prisma } from '@prisma/client';
import { UserRole } from '@/modules/domain/contracts';
import { randomUUID } from 'crypto';
import { formatTelegramError } from '@/modules/telegram/telegram-error.util';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';

@Update()
export class AdvertiserHandler {
    private readonly logger = new Logger(AdvertiserHandler.name);

    constructor(
        private readonly fsm: TelegramFSMService,
        private readonly prisma: PrismaService,
        private readonly backendClient: TelegramBackendClient,
    ) { }

    @Action('ROLE_ADVERTISER')
    async enter(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);

        if (!context) {
            return;
        }

        await this.fsm.set(
            userId,
            'advertiser',
            TelegramState.ADV_DASHBOARD,
        );

        await ctx.reply(
            `🧑‍💼 Advertiser Panel\n\n💰 Balance: $0\n📊 Active campaigns: 0`,
            advertiserHome,
        );
    }

    @Action('ADD_BALANCE')
    async addBalance(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADD_BALANCE_AMOUNT,
        );

        await ctx.reply('💰 Enter amount (USD):');
    }

    @Action('CREATE_ADDEAL')
    async beginCreateAdDeal(@Ctx() ctx: Context) {
        const userId = ctx.from!.id;
        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }

        await this.fsm.transition(
            userId,
            TelegramState.ADV_ADDEAL_PUBLISHER,
        );

        await ctx.reply(
            '🤝 Send the publisher @username or a public channel/group link (t.me/...).',
        );
    }

    @On('text')
    async onText(@Ctx() ctx: Context) {
        const text =
            ctx.message && 'text' in ctx.message ? ctx.message.text : null;
        if (!text) return;

        const userId = ctx.from!.id;
        const commandMatch = text.match(/^\/(fund_addeal|lock_addeal)\s+(\S+)/);
        if (commandMatch) {
            const [, command, adDealId] = commandMatch;
            const context = await this.ensureAdvertiser(ctx);
            if (!context) {
                return;
            }
            const fsm = context.fsm;
            try {
                const adDeal = await this.prisma.adDeal.findUnique({
                    where: { id: adDealId },
                });

                if (!adDeal || adDeal.advertiserId !== context.user.id) {
                    return ctx.reply('❌ AdDeal not found for advertiser');
                }

                if (command === 'fund_addeal') {
                    await this.backendClient.fundAdDeal({
                        adDealId,
                        provider: 'wallet_balance',
                        providerReference: `telegram:${userId}:${adDealId}`,
                        amount: adDeal.amount.toFixed(2),
                    });
                    return ctx.reply(`✅ AdDeal funded\nID: ${adDealId}`);
                }

                if (command === 'lock_addeal') {
                    await this.backendClient.lockAdDeal(adDealId);
                    return ctx.reply(`🔒 Escrow locked\nID: ${adDealId}`);
                }
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_addeal_command_failed',
                    command,
                    adDealId,
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        const publisherResolution = await this.resolvePublisherInput(text, userId);
        if (publisherResolution) {
            if (!publisherResolution.ok) {
                return ctx.reply(`❌ ${publisherResolution.reason}`);
            }

            const context = await this.ensureAdvertiser(ctx);
            if (!context) {
                return;
            }

            const publisher = publisherResolution.publisher;
            if (publisher.id === context.user.id) {
                return ctx.reply('❌ You cannot create a deal with yourself.');
            }

            this.logger.log({
                event: 'publisher_resolved',
                advertiserId: context.user.id,
                publisherId: publisher.id,
                publisherTelegramId: publisher.telegramId?.toString(),
                source: publisherResolution.source,
                channelId: publisherResolution.channel?.id ?? null,
            });

            await this.fsm.transition(
                userId,
                TelegramState.ADV_ADDEAL_AMOUNT,
                { publisherId: publisher.id },
            );

            const publisherLabel =
                publisher.username
                    ? `@${publisher.username}`
                    : publisherResolution.channel?.title ?? 'publisher';

            return ctx.reply(
                `✅ Publisher selected: ${publisherLabel}\n💵 Enter deal amount (USD):`,
            );
        }

        const context = await this.ensureAdvertiser(ctx);
        if (!context) {
            return;
        }
        const fsm = context.fsm;

        if (fsm.state === TelegramState.ADV_ADD_BALANCE_AMOUNT) {
            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return ctx.reply('❌ Invalid amount');
            }
            const amount = new Prisma.Decimal(amountText);
            if (amount.lte(0)) {
                return ctx.reply('❌ Invalid amount');
            }

            try {
                const idempotencyKey = `telegram:deposit:${userId}:${randomUUID()}`;
                const intent = await this.backendClient.createDepositIntent({
                    userId: context.user.id,
                    amount: amount.toFixed(2),
                    idempotencyKey,
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                    { amount: amount.toFixed(2) },
                );

                return ctx.reply(
                    `✅ Deposit intent created\nAmount: $${amount.toFixed(2)}\nPay here: ${intent.paymentUrl ?? 'pending'}`,
                );
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_deposit_failed',
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_PUBLISHER) {
            return ctx.reply(
                '❌ Please send a publisher @username or a public channel/group link (t.me/...).',
            );
        }

        if (fsm.state === TelegramState.ADV_ADDEAL_AMOUNT) {
            if (!fsm.payload.publisherId) {
                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_ADDEAL_PUBLISHER,
                );
                return ctx.reply(
                    '⚠️ Please select a publisher first by sending @username or a public channel/group link (t.me/...).',
                );
            }

            const amountText = text.trim();
            if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
                return ctx.reply('❌ Invalid amount');
            }

            if (new Prisma.Decimal(amountText).lte(0)) {
                return ctx.reply('❌ Invalid amount');
            }

            try {
                const wallet = await this.prisma.wallet.findUnique({
                    where: { userId: context.user.id },
                });

                const requiredAmount = new Prisma.Decimal(amountText);
                if (!wallet || wallet.balance.lt(requiredAmount)) {
                    return ctx.reply(
                        `❌ Insufficient balance. Deposit at least $${requiredAmount.toFixed(2)} before creating a deal.`,
                    );
                }

                const adDeal = await this.backendClient.createAdDeal({
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                    amount: amountText,
                });

                this.logger.log({
                    event: 'addeal_created',
                    adDealId: adDeal.id,
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                    amount: amountText,
                });

                await this.backendClient.fundAdDeal({
                    adDealId: adDeal.id,
                    provider: 'wallet_balance',
                    providerReference: `telegram:${userId}:${adDeal.id}`,
                    amount: amountText,
                });

                await this.backendClient.lockAdDeal(adDeal.id);

                this.logger.log({
                    event: 'escrow_locked',
                    adDealId: adDeal.id,
                    advertiserId: context.user.id,
                    publisherId: fsm.payload.publisherId,
                });

                await this.fsm.transition(
                    userId,
                    TelegramState.ADV_DASHBOARD,
                );

                return ctx.reply(
                    `✅ AdDeal created & escrow locked\nID: ${adDeal.id}\n\n` +
                    `Next steps:\n` +
                    `• Publisher: /accept_addeal ${adDeal.id}\n` +
                    `• Publisher: /submit_proof ${adDeal.id} <proof>`,
                );
            } catch (err) {
                const message = formatTelegramError(err);
                this.logger.error({
                    event: 'telegram_addeal_create_failed',
                    userId,
                    role: fsm.role,
                    state: fsm.state,
                    error: message,
                });
                return ctx.reply(`❌ ${message}`);
            }
        }

        if (
            fsm.state === TelegramState.IDLE
            || fsm.state === TelegramState.SELECT_ROLE
        ) {
            await ctx.reply('ℹ️ Session expired. Use /start to choose your role.');
            return;
        }

        return undefined;
    }

    private async resolvePublisherInput(value: string, advertiserTelegramId?: number) {
        const trimmed = value.trim();
        const parsed = this.parsePublisherIdentifier(trimmed);
        if (!parsed) {
            return null;
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
                publisher: publisherByUsername,
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
                publisher: channel.owner,
                source: parsed.source,
                channel,
            };
        }

        this.logger.warn({
            event: 'publisher_not_registered',
            advertiserTelegramId: advertiserTelegramId ?? null,
            identifier: value,
        });

        return {
            ok: false as const,
            reason: 'Publisher not found. Send a valid @username or a public channel/group link.',
        };
    }

    private parsePublisherIdentifier(value: string) {
        const usernameRegex = /^(?=.{5,32}$)(?=.*[A-Za-z])[A-Za-z0-9_]+$/;
        if (!value) {
            return null;
        }

        if (value.startsWith('@')) {
            const username = value.slice(1);
            if (!usernameRegex.test(username)) {
                return { error: 'That @username does not look valid.' };
            }
            return { username, source: 'username' as const };
        }

        const linkMatch = value.match(
            /^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i,
        );
        if (linkMatch) {
            const path = linkMatch[1];
            const lowered = path.toLowerCase();
            if (lowered === 'c' || lowered === 'joinchat' || path.startsWith('+')) {
                return {
                    error:
                        'Invite links cannot be used for publisher lookup. Please send a public @username or t.me/username.',
                };
            }
            if (!usernameRegex.test(path)) {
                return { error: 'That t.me link does not look like a public username.' };
            }
            return { username: path, source: 'link' as const };
        }

        if (usernameRegex.test(value)) {
            return { username: value, source: 'username' as const };
        }

        return null;
    }

    private async ensureAdvertiser(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Telegram user not found.');
            return null;
        }

        const user = await this.prisma.user.findUnique({
            where: { telegramId: BigInt(userId) },
        });

        if (!user) {
            await ctx.reply('❌ Advertiser account not found.');
            return null;
        }

        if (user.role !== UserRole.advertiser) {
            this.logger.warn({
                event: 'telegram_role_block',
                action: 'advertiser_access',
                userId,
                role: user.role,
            });
            await ctx.reply(
                `⛔ Not allowed. Your account role is ${user.role}.`,
            );
            return null;
        }

        const fsm = await this.fsm.get(userId);
        const syncedFsm =
            fsm.role !== 'advertiser'
                ? await this.fsm.updateRole(userId, 'advertiser')
                : fsm;

        return { user, fsm: syncedFsm };
    }
}
