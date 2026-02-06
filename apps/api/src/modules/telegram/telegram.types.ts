export enum TelegramCheckReason {
    CHAT_NOT_FOUND = 'CHAT_NOT_FOUND',
    BOT_NOT_ADMIN = 'BOT_NOT_ADMIN',
    BOT_KICKED = 'BOT_KICKED',
    USER_NOT_ADMIN = 'USER_NOT_ADMIN',
    RATE_LIMIT = 'RATE_LIMIT',
    NETWORK = 'NETWORK',
    UNKNOWN = 'UNKNOWN',
}

export type TelegramAdminPermission =
    | 'can_manage_chat'
    | 'can_post_messages'
    | 'can_edit_messages'
    | 'can_delete_messages';

export interface TelegramCheckResult {
    canAccessChat: boolean;
    isAdmin: boolean;
    reason: TelegramCheckReason;
    telegramError?: string;
    retryAfterSeconds?: number | null;
}

export type TelegramResolvePublisherFailureReason =
    | 'IDENTIFIER_INVALID'
    | 'CHANNEL_NOT_FOUND'
    | 'CHANNEL_NOT_APPROVED'
    | 'CHANNEL_OWNER_NOT_PUBLISHER'
    | 'PUBLISHER_NOT_REGISTERED';

export type TelegramResolvePublisherResult =
    | {
        ok: true;
        publisher: { id: string; telegramId: string | null; username: string | null };
        channel?: { id: string; title: string; username: string | null };
        source: 'link' | 'username';
    }
    | {
        ok: false;
        reason: TelegramResolvePublisherFailureReason;
        message: string;
        debug?: string;
    };
