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
