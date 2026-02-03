import { Injectable, LoggerService, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { TelegramCheckReason } from '@/modules/telegram/telegram.types';

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
    source: 'public_username' | 'private_signal' | 'telegram_channel_id';
};

type UserIdentity = {
    telegramId: string;
    username?: string;
    source: 'public_username' | 'telegram_id';
};

@Injectable()
export class IdentityResolverService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly telegramService: TelegramService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

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
                    error: 'Invite links are not supported. Please send a public @username or t.me/username.',
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
        options?: { allowTelegramId?: boolean; actorId?: string },
    ): Promise<IdentityResolutionResult<ChannelIdentity>> {
        this.logStart('identity_resolution_started', {
            type: 'channel',
            actorId: options?.actorId ?? null,
            identifier,
        });

        const trimmed = identifier.trim();
        if (options?.allowTelegramId && /^-100\d{5,}$/.test(trimmed)) {
            return {
                ok: true,
                value: {
                    telegramChannelId: trimmed,
                    title: 'Unknown Channel',
                    source: 'telegram_channel_id',
                },
            };
        }

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

        const resolved = await this.telegramService.resolvePublicChannel(parsed.username);
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
            const botAdmin = await this.telegramService.checkBotAdmin(channelId);
            if (!botAdmin.isAdmin) {
                continue;
            }

            const userAdmin = await this.telegramService.checkUserAdmin(
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
        options?: { allowTelegramId?: boolean; actorId?: string },
    ): Promise<IdentityResolutionResult<UserIdentity>> {
        this.logStart('identity_resolution_started', {
            type: 'user',
            actorId: options?.actorId ?? null,
            identifier,
        });

        const trimmed = identifier.trim();
        if (options?.allowTelegramId && /^\d+$/.test(trimmed)) {
            return {
                ok: true,
                value: {
                    telegramId: trimmed,
                    source: 'telegram_id',
                },
            };
        }

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

        const resolved = await this.telegramService.resolvePublicUser(parsed.username);
        if (!resolved.ok) {
            const reason = resolved.reason ?? TelegramCheckReason.CHAT_NOT_FOUND;
            this.logWarn('identity_resolution_failed', {
                type: 'user',
                actorId: options?.actorId ?? null,
                reason,
            });
            return {
                ok: false,
                reason,
                message:
                    '@username is not reachable by the bot. Ask the user to start the bot or provide a public username.',
                telegramError: resolved.telegramError,
            };
        }

        this.logStart('identity_resolved', {
            type: 'user',
            actorId: options?.actorId ?? null,
            telegramId: resolved.telegramId,
            source: 'public_username',
        });

        return {
            ok: true,
            value: {
                telegramId: resolved.telegramId,
                username: resolved.username,
                source: 'public_username',
            },
        };
    }

    ensureIdentifier(identifier?: string, fieldName = 'identifier') {
        if (!identifier) {
            throw new BadRequestException(`Missing ${fieldName}. Provide a Telegram @username or t.me link.`);
        }
    }
}
