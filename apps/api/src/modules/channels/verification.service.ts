import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { Channel } from '@prisma/client';

@Injectable()
export class VerificationService {
    private readonly logger = new Logger(VerificationService.name);

    constructor(private readonly telegramService: TelegramService) {}

    async verifyChannel(channel: Channel): Promise<boolean> {
        const channelId = channel.telegramChannelId.toString();
        try {
            return await this.telegramService.isBotAdmin(channelId);
        } catch (err) {
            this.logger.error(
                `Channel verification failed for ${channelId}`,
                err instanceof Error ? err.stack : String(err),
            );
            return false;
        }
    }
}
