import { AdDeal as AdDealRecord } from '@prisma/client';

import { DealState } from '@/modules/domain/contracts';
import { AdDealSnapshot } from '@/modules/domain/addeal/addeal.types';

export function toAdDealSnapshot(record: AdDealRecord): AdDealSnapshot {
    return {
        id: record.id,
        advertiserId: record.advertiserId,
        publisherId: record.publisherId,
        amount: record.amount.toFixed(2),
        currency: record.currency,
        status: record.status as DealState,
        createdAt: record.createdAt,
        fundedAt: record.fundedAt,
        lockedAt: record.lockedAt,
        publisherRequestedAt: record.publisherRequestedAt,
        publisherDeclinedAt: record.publisherDeclinedAt,
        acceptedAt: record.acceptedAt,
        advertiserConfirmedAt: record.advertiserConfirmedAt,
        proofSubmittedAt: record.proofSubmittedAt,
        settledAt: record.settledAt,
        refundedAt: record.refundedAt,
        disputedAt: record.disputedAt,
    };
}
