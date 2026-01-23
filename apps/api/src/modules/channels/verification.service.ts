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
                message: 'Channel verification failed',
                channelId,
                reason: result.reason,
                telegramError: result.telegramError ?? null,
                canAccessChat: result.canAccessChat,
            });
        }

        if (result.reason === TelegramCheckReason.UNKNOWN && !result.isAdmin) {
            this.logger.error(
                `Channel verification returned unknown failure for ${channelId}`,
            );
        }

        return result;
    }
}
