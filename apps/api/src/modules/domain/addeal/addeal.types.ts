export enum AdDealStatus {
    created = 'created',
    funded = 'funded',
    escrow_locked = 'escrow_locked',
    accepted = 'accepted',
    proof_submitted = 'proof_submitted',
    settled = 'settled',
    refunded = 'refunded',
    disputed = 'disputed',
}

export type AdDealSnapshot = {
    id: string;
    advertiserId: string;
    publisherId: string;
    amount: string;
    currency: string;
    status: AdDealStatus;
    createdAt: Date;
    fundedAt?: Date | null;
    lockedAt?: Date | null;
    acceptedAt?: Date | null;
    proofSubmittedAt?: Date | null;
    settledAt?: Date | null;
    refundedAt?: Date | null;
    disputedAt?: Date | null;
};