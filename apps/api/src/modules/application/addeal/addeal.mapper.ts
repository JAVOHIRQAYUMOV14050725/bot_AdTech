import { AdDeal as AdDealRecord } from '@prisma/client';

import { AdDealSnapshot, AdDealStatus } from '@/modules/domain/addeal/addeal.types';

export function toAdDealSnapshot(record: AdDealRecord): AdDealSnapshot {
    return {
        id: record.id,
        advertiserId: record.advertiserId,
        publisherId: record.publisherId,
        amount: record.amount.toFixed(2),
        currency: record.currency,
        status: record.status as AdDealStatus,
        createdAt: record.createdAt,
        fundedAt: record.fundedAt,
        lockedAt: record.lockedAt,
        acceptedAt: record.acceptedAt,
        proofSubmittedAt: record.proofSubmittedAt,
        settledAt: record.settledAt,
        refundedAt: record.refundedAt,
        disputedAt: record.disputedAt,
    };
}
