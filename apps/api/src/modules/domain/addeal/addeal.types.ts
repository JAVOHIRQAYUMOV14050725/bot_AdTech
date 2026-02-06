import { DealState } from "../contracts";

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
    publisherRequestedAt?: Date | null;
    publisherDeclinedAt?: Date | null;
    acceptedAt?: Date | null;
    advertiserConfirmedAt?: Date | null;
    proofSubmittedAt?: Date | null;
    settledAt?: Date | null;
    refundedAt?: Date | null;
    disputedAt?: Date | null;
};