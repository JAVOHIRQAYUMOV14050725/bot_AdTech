export type TelegramRole = 'advertiser' | 'publisher' | 'admin' | null;

export enum TelegramState {
    IDLE = 'IDLE',
    SELECT_ROLE = 'SELECT_ROLE',

    // Advertiser
    ADV_DASHBOARD = 'ADV_DASHBOARD',
    ADV_ADD_BALANCE_AMOUNT = 'ADV_ADD_BALANCE_AMOUNT',
    ADV_CREATE_CAMPAIGN_NAME = 'ADV_CREATE_CAMPAIGN_NAME',
    ADV_ADDEAL_PUBLISHER = 'ADV_ADDEAL_PUBLISHER',
    ADV_ADDEAL_AMOUNT = 'ADV_ADDEAL_AMOUNT',

    // Publisher
    PUB_DASHBOARD = 'PUB_DASHBOARD',
    PUB_ADD_CHANNEL = 'PUB_ADD_CHANNEL',
    PUB_ADDEAL_PROOF = 'PUB_ADDEAL_PROOF',

    // Admin
    ADMIN_PANEL = 'ADMIN_PANEL',
}

export interface FSMContext {
    role: TelegramRole;
    state: TelegramState;
    payload: Record<string, any>;
}