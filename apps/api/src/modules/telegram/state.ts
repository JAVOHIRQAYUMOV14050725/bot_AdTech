// src/telegram/state.ts
export enum UserFlow {
    NONE = 'none',
    ADD_BALANCE_AMOUNT = 'add_balance_amount',
    ADD_CHANNEL_USERNAME = 'add_channel_username',
    CREATE_CAMPAIGN_NAME = 'create_campaign_name',
}

export type UserSession = {
    flow: UserFlow;
    payload?: Record<string, any>;
};
