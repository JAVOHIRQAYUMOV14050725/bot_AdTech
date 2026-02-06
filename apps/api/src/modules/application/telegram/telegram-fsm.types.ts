export type TelegramRole = 'advertiser' | 'publisher' | 'admin' | null;

export enum TelegramFlow {
    NONE = 'NONE',
    CREATE_CAMPAIGN = 'CREATE_CAMPAIGN',
    CREATE_AD_DEAL = 'CREATE_AD_DEAL',
    ADD_BALANCE = 'ADD_BALANCE',
    PUBLISHER_ONBOARDING = 'PUBLISHER_ONBOARDING',
}

export enum TelegramFlowStep {
    NONE = 'NONE',

    // Advertiser
    ADV_CREATE_CAMPAIGN_NAME = 'ADV_CREATE_CAMPAIGN_NAME',
    ADV_ADDEAL_PUBLISHER = 'ADV_ADDEAL_PUBLISHER',
    ADV_ADDEAL_AMOUNT = 'ADV_ADDEAL_AMOUNT',
    ADV_ADD_BALANCE_AMOUNT = 'ADV_ADD_BALANCE_AMOUNT',

    // Publisher
    PUB_ADD_CHANNEL_PUBLIC = 'PUB_ADD_CHANNEL_PUBLIC',
    PUB_ADD_CHANNEL_PRIVATE = 'PUB_ADD_CHANNEL_PRIVATE',
    PUB_ADDEAL_PROOF = 'PUB_ADDEAL_PROOF',
}

export interface FSMContext {
    flow: TelegramFlow;
    step: TelegramFlowStep;
    payload: Record<string, any>;
}