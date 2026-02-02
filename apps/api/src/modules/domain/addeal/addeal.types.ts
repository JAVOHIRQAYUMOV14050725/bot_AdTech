import { DealState } from '@/modules/domain/contracts';

export type AdDealSnapshot = {
    id: string;
    advertiserId: string;
    publisherId: string;
    amount: string;
    currency: string;
    status: DealState;
    createdAt: Date;
    fundedAt?: Date | null;
    lockedAt?: Date | null;
    acceptedAt?: Date | null;
    proofSubmittedAt?: Date | null;
    settledAt?: Date | null;
    refundedAt?: Date | null;
    disputedAt?: Date | null;
};
