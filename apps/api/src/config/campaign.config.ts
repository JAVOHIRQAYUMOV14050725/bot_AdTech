import { registerAs } from '@nestjs/config';
import { loadEnv } from './env';

export type CampaignConfig = {
    minLeadMs: number;
};

export const campaignConfig = registerAs(
    'campaign',
    (): CampaignConfig => {
        const env = loadEnv();
        return {
            minLeadMs: env.CAMPAIGN_TARGET_MIN_LEAD_MS,
        };
    },
);
