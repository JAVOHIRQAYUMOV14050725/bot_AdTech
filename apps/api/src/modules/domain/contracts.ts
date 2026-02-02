import { AdDealStatus, LedgerReason, LedgerType, UserRole } from '@prisma/client';

export const DealState = AdDealStatus;
export type DealState = AdDealStatus;

export enum TransitionActor {
    system = 'system',
    payment_provider = 'payment_provider',
    worker = 'worker',
    admin = 'admin',
    advertiser = 'advertiser',
    publisher = 'publisher',
}

export { LedgerReason, LedgerType, UserRole };