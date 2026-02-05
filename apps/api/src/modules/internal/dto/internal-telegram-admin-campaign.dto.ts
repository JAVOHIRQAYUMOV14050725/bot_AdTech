import { IsString } from 'class-validator';
import { IsTelegramIdString } from '@/common/validators/telegram-id-string.decorator';

export class InternalTelegramAdminCampaignDto {
    @IsString()
    @IsTelegramIdString()
    telegramId!: string;

    @IsString()
    campaignId!: string;
}
