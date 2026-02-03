import { Injectable, LoggerService, BadRequestException, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '@/prisma/prisma.service';
import { TelegramCheckReason } from '@/modules/telegram/telegram.types';
import { TELEGRAM_IDENTITY_ADAPTER, TelegramIdentityAdapter } from './telegram-identity.adapter';

type ParsedIdentifier =
    | { username: string }
    | { error: string }
    | null;

type IdentityResolutionResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string; message: string; telegramError?: string | null };

type ChannelIdentity = {
    telegramChannelId: string;
    title: string;
    username?: string;
    source: 'public_username' | 'private_signal' | 'database';
};

type UserIdentity = {
    telegramId: string;
    username?: string;
    source: 'public_username' | 'database';
};

@Injectable()
export class IdentityResolverService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly moduleRef: ModuleRef,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

    private getTelegramAdapter(): TelegramIdentityAdapter {
        const adapter = this.moduleRef.get<TelegramIdentityAdapter>(TELEGRAM_IDENTITY_ADAPTER, { strict: false });
        if (!adapter) {
            throw new ServiceUnavailableException('Telegram adapter is not configured.');
        }
        return adapter;
    }

    private parseIdentifier(value: string): ParsedIdentifier {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const usernameRegex = /^[A-Za-z0-9_]{5,32}$/;

        if (trimmed.startsWith('@')) {
            const username = trimmed.slice(1);
            if (!usernameRegex.test(username)) {
                return { error: 'That @username format is invalid. Please send a public @username.' };
            }
            return { username };
        }

        const linkMatch = trimmed.match(/^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i);
        if (linkMatch) {
            const path = linkMatch[1];
            const lowered = path.toLowerCase();
            if (lowered === 'c' || lowered === 'joinchat' || path.startsWith('+')) {
                return {
                    error:
                        'Invite links cannot be verified here. For private channels, add the bot as ADMIN and use the private verification flow, or send a public @username.',
                };
            }
            if (!usernameRegex.test(path)) {
                return { error: 'That t.me link does not look like a public username.' };
            }
            return { username: path };
        }

        if (usernameRegex.test(trimmed)) {
            return { username: trimmed };
        }

        return null;
    }

    private logStart(event: string, data: Record<string, unknown>) {
        this.logger.log(
            {
                event,
                ...data,
            },
            'IdentityResolverService',
        );
    }

    private logWarn(event: string, data: Record<string, unknown>) {
        this.logger.warn(
            {
                event,
                ...data,
            },
            'IdentityResolverService',
        );
    }

    async resolveChannelIdentifier(
        identifier: string,
        options?: { actorId?: string },
    ): Promise<IdentityResolutionResult<ChannelIdentity>> {
        this.logStart('identity_resolution_started', {
            type: 'channel',
            actorId: options?.actorId ?? null,
            identifier,
        });

        const trimmed = identifier.trim();
        const parsed = this.parseIdentifier(trimmed);
        if (!parsed) {
            return {
                ok: false,
                reason: 'invalid_identifier',
                message: 'Please send a valid @username or public t.me link.',
            };
        }
        if ('error' in parsed) {
            return { ok: false, reason: 'invalid_identifier', message: parsed.error };
        }

        const channelByUsername = await this.prisma.channel.findFirst({
            where: { username: { equals: parsed.username, mode: 'insensitive' } },
        });
        if (channelByUsername) {
            this.logStart('identity_resolved', {
                type: 'channel',
                actorId: options?.actorId ?? null,
                telegramChannelId: channelByUsername.telegramChannelId.toString(),
                source: 'database',
            });
            return {
                ok: true,
                value: {
                    telegramChannelId: channelByUsername.telegramChannelId.toString(),
                    title: channelByUsername.title,
                    username: channelByUsername.username ?? undefined,
                    source: 'database',
                },
            };
        }

        const resolved = await this.getTelegramAdapter().resolvePublicChannel(parsed.username);
        if (!resolved.ok) {
            this.logWarn('identity_resolution_failed', {
                type: 'channel',
                actorId: options?.actorId ?? null,
                reason: resolved.reason,
            });
            return {
                ok: false,
                reason: resolved.reason,
                message: '@username is not a public channel, or the bot cannot access it yet.',
                telegramError: resolved.telegramError,
            };
        }

        await this.prisma.channel.updateMany({
            where: { telegramChannelId: BigInt(resolved.telegramChannelId) },
            data: {
                title: resolved.title,
                username: resolved.username ?? undefined,
            },
        });

        this.logStart('identity_resolved', {
            type: 'channel',
            actorId: options?.actorId ?? null,
            telegramChannelId: resolved.telegramChannelId,
            source: 'public_username',
        });

        return {
            ok: true,
            value: {
                telegramChannelId: resolved.telegramChannelId,
                title: resolved.title,
                username: resolved.username,
                source: 'public_username',
            },
        };
    }

    async resolvePrivateChannelForUser(params: {
        actorId: string;
        telegramUserId: number;
    }): Promise<IdentityResolutionResult<ChannelIdentity>> {
        this.logStart('channel_verification_started', {
            actorId: params.actorId,
            flow: 'private_no_username',
        });

        const recentSignals = await this.prisma.telegramChannelSignal.findMany({
            orderBy: { receivedAt: 'desc' },
            take: 8,
        });

        if (recentSignals.length === 0) {
            return {
                ok: false,
                reason: 'no_channel_signal',
                message:
                    'We could not detect your channel yet. Add the bot as ADMIN, post a message, then try again.',
            };
        }

        for (const signal of recentSignals) {
            const channelId = signal.telegramChannelId.toString();
            const botAdmin = await this.getTelegramAdapter().checkBotAdmin(channelId);
            if (!botAdmin.isAdmin) {
                continue;
            }

            const userAdmin = await this.getTelegramAdapter().checkUserAdmin(
                channelId,
                params.telegramUserId,
            );
            if (!userAdmin.isAdmin) {
                continue;
            }

            this.logStart('channel_verified', {
                actorId: params.actorId,
                telegramChannelId: channelId,
                flow: 'private_no_username',
            });

            this.logStart('identity_resolved', {
                type: 'channel',
                actorId: params.actorId,
                telegramChannelId: channelId,
                source: 'private_signal',
            });

            return {
                ok: true,
                value: {
                    telegramChannelId: channelId,
                    title: signal.title ?? 'Untitled Channel',
                    username: signal.username ?? undefined,
                    source: 'private_signal',
                },
            };
        }

        return {
            ok: false,
            reason: 'bot_or_user_not_admin',
            message:
                'Verification failed. Make sure the bot and you are both admins of the channel, then try again.',
        };
    }

    async resolveUserIdentifier(
        identifier: string,
        options?: { actorId?: string },
    ): Promise<IdentityResolutionResult<UserIdentity>> {
        this.logStart('identity_resolution_started', {
            type: 'user',
            actorId: options?.actorId ?? null,
            identifier,
        });

        const trimmed = identifier.trim();
        const parsed = this.parseIdentifier(trimmed);
        if (!parsed) {
            return {
                ok: false,
                reason: 'invalid_identifier',
                message: 'Please send a valid @username or t.me link.',
            };
        }
        if ('error' in parsed) {
            return { ok: false, reason: 'invalid_identifier', message: parsed.error };
        }

        const userByUsername = await this.prisma.user.findFirst({
            where: { username: { equals: parsed.username, mode: 'insensitive' } },
        });
        if (userByUsername?.telegramId) {
            this.logStart('identity_resolved', {
                type: 'user',
                actorId: options?.actorId ?? null,
                telegramId: userByUsername.telegramId.toString(),
                source: 'database',
            });
            return {
                ok: true,
                value: {
                    telegramId: userByUsername.telegramId.toString(),
                    username: userByUsername.username ?? undefined,
                    source: 'database',
                },
            };
        }

        this.logWarn('identity_resolution_failed', {
            type: 'user',
            actorId: options?.actorId ?? null,
            reason: 'user_not_started_bot',
        });

        return {
            ok: false,
            reason: TelegramCheckReason.CHAT_NOT_FOUND,
            message:
                'This user has not started the bot yet. Ask them to press /start in the Telegram bot first.',
        };
    }

    ensureIdentifier(identifier?: string, fieldName = 'identifier') {
        if (!identifier) {
            throw new BadRequestException(`Missing ${fieldName}. Provide a Telegram @username or t.me link.`);
        }
    }
}
