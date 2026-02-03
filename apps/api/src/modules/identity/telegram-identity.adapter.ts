import { TelegramCheckReason, TelegramCheckResult } from '@/modules/telegram/telegram.types';

export const TELEGRAM_IDENTITY_ADAPTER = Symbol('TELEGRAM_IDENTITY_ADAPTER');

export interface TelegramIdentityAdapter {
    resolvePublicChannel(
        username: string,
    ): Promise<
        | {
            ok: true;
            telegramChannelId: string;
            title: string;
            username?: string;
        }
        | {
            ok: false;
            reason: TelegramCheckReason;
            telegramError?: string;
        }
    >;
    resolvePublicUser(
        username: string,
    ): Promise<
        | {
            ok: true;
            telegramId: string;
            username?: string;
        }
        | {
            ok: false;
            reason: TelegramCheckReason;
            telegramError?: string;
        }
    >;
    checkBotAdmin(channelId: string): Promise<TelegramCheckResult>;
    checkUserAdmin(channelId: string, userId: number): Promise<TelegramCheckResult>;
}
