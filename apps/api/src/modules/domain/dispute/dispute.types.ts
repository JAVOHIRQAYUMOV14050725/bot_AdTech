export enum DisputeStatus {
    open = 'open',
    resolved = 'resolved',
}

export enum DisputeResolution {
    release = 'release',
    refund = 'refund',
}

export type DisputeSnapshot = {
    id: string;
    adDealId: string;
    openedBy: string;
    reason: string;
    status: DisputeStatus;
    resolution?: DisputeResolution | null;
    resolvedBy?: string | null;
    resolvedAt?: Date | null;
    createdAt: Date;
};
