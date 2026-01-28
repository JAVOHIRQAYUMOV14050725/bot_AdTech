import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { Channel } from '@prisma/client';
import { TelegramCheckReason, TelegramCheckResult } from '@/modules/telegram/telegram.types';
@Injectable()
export class VerificationService {
    private readonly logger = new Logger(VerificationService.name);

    constructor(private readonly telegramService: TelegramService) { }

    async verifyChannel(channel: Channel): Promise<TelegramCheckResult> {
        const channelId = channel.telegramChannelId.toString();
        const result = await this.telegramService.checkBotAdmin(channelId);

        if (!result.isAdmin) {
            this.logger.warn({
                message: `Bot is not admin in channel ${channelId}`,
                channelId,
                reason: result.reason,
                telegramError: result.telegramError ?? null,
                canAccessChat: result.canAccessChat,
            });
        }

        if (result.reason === TelegramCheckReason.UNKNOWN && !result.isAdmin) {
            this.logger.error({
                message: `Unexpected failure verifying bot admin status in channel ${channelId}`,
                channelId,
                telegramError: result.telegramError ?? null,
                canAccessChat: result.canAccessChat,
            },
                'VerificationService',
            );
        }

        return result;
    }
}