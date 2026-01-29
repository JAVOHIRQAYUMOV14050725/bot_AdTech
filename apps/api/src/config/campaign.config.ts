import { ConfigType, registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export const campaignConfig = registerAs('campaign', () => {
    const env = loadEnv();
    return {
        minLeadMs: env.CAMPAIGN_TARGET_MIN_LEAD_MS,
    };
});

export type CampaignConfig = ConfigType<typeof campaignConfig>;
