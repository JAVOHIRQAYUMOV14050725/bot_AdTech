import { IsString } from 'class-validator';

export class InternalTelegramAdminCampaignDto {
    @IsString()
    telegramId!: string;

    @IsString()
    campaignId!: string;
}
