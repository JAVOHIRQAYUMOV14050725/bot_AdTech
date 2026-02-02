import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdDealSnapshot, AdDealStatus } from './addeal.types';

type TransitionMap = Record<AdDealStatus, Set<AdDealStatus>>;

const AD_DEAL_TRANSITIONS: TransitionMap = {
    [AdDealStatus.created]: new Set([AdDealStatus.funded]),
    [AdDealStatus.funded]: new Set([AdDealStatus.escrow_locked]),
    [AdDealStatus.escrow_locked]: new Set([
        AdDealStatus.accepted,
        AdDealStatus.refunded,
        AdDealStatus.disputed,
    ]),
    [AdDealStatus.accepted]: new Set([
        AdDealStatus.proof_submitted,
        AdDealStatus.disputed,
    ]),
    [AdDealStatus.proof_submitted]: new Set([
        AdDealStatus.settled,
        AdDealStatus.refunded,
        AdDealStatus.disputed,
    ]),
    [AdDealStatus.settled]: new Set([]),
    [AdDealStatus.refunded]: new Set([]),
    [AdDealStatus.disputed]: new Set([
        AdDealStatus.settled,
        AdDealStatus.refunded,
    ]),
};

export class AdDeal {
    private constructor(private readonly snapshot: AdDealSnapshot) {
        this.assertInvariant(snapshot);
    }

    static create(params: {
        id: string;
        advertiserId: string;
        publisherId: string;
        amount: Prisma.Decimal;
        currency: string;
        createdAt?: Date;
    }) {
        const createdAt = params.createdAt ?? new Date();
        const normalizedAmount = AdDeal.normalizeAmount(params.amount);

        return new AdDeal({
            id: params.id,
            advertiserId: params.advertiserId,
            publisherId: params.publisherId,
            amount: normalizedAmount.toFixed(2),
            currency: params.currency,
            status: AdDealStatus.created,
            createdAt,
        });
    }

    static rehydrate(snapshot: AdDealSnapshot) {
        return new AdDeal(snapshot);
    }

    fund(fundedAt?: Date) {
        return this.transition(AdDealStatus.funded, {
            fundedAt: fundedAt ?? new Date(),
        });
    }

    lockEscrow(lockedAt?: Date) {
        return this.transition(AdDealStatus.escrow_locked, {
            lockedAt: lockedAt ?? new Date(),
        });
    }

    accept(acceptedAt?: Date) {
        return this.transition(AdDealStatus.accepted, {
            acceptedAt: acceptedAt ?? new Date(),
        });
    }

    submitProof(submittedAt?: Date) {
        return this.transition(AdDealStatus.proof_submitted, {
            proofSubmittedAt: submittedAt ?? new Date(),
        });
    }

    settle(settledAt?: Date) {
        return this.transition(AdDealStatus.settled, {
            settledAt: settledAt ?? new Date(),
        });
    }

    refund(refundedAt?: Date) {
        return this.transition(AdDealStatus.refunded, {
            refundedAt: refundedAt ?? new Date(),
        });
    }

    dispute(disputedAt?: Date) {
        return this.transition(AdDealStatus.disputed, {
            disputedAt: disputedAt ?? new Date(),
        });
    }

    toSnapshot(): AdDealSnapshot {
        return { ...this.snapshot };
    }

    private transition(status: AdDealStatus, updates: Partial<AdDealSnapshot>) {
        this.assertTransition(this.snapshot.status, status);
        const nextSnapshot: AdDealSnapshot = {
            ...this.snapshot,
            ...updates,
            status,
        };
        return new AdDeal(nextSnapshot);
    }

    private assertInvariant(snapshot: AdDealSnapshot) {
        if (!snapshot.id) {
            throw new BadRequestException('AdDeal requires id');
        }
        if (!snapshot.advertiserId || !snapshot.publisherId) {
            throw new BadRequestException('AdDeal must include participants');
        }
        if (snapshot.advertiserId === snapshot.publisherId) {
            throw new BadRequestException('AdDeal participants must differ');
        }
        if (!snapshot.currency) {
            throw new BadRequestException('AdDeal requires currency');
        }

        const amount = AdDeal.normalizeAmount(snapshot.amount);
        if (amount.lte(0)) {
            throw new BadRequestException('AdDeal amount must be positive');
        }

        if (snapshot.status !== AdDealStatus.created && !snapshot.fundedAt) {
            throw new BadRequestException(
                'AdDeal funding timestamp required after funding',
            );
        }

        if (
            [
                AdDealStatus.escrow_locked,
                AdDealStatus.accepted,
                AdDealStatus.proof_submitted,
                AdDealStatus.settled,
                AdDealStatus.disputed,
            ].includes(snapshot.status) && !snapshot.lockedAt
        ) {
            throw new BadRequestException(
                'AdDeal escrow lock timestamp required after lock',
            );
        }

        if (
            [
                AdDealStatus.accepted,
                AdDealStatus.proof_submitted,
                AdDealStatus.settled,
            ].includes(snapshot.status) && !snapshot.acceptedAt
        ) {
            throw new BadRequestException('AdDeal accept timestamp required');
        }

        if (
            [AdDealStatus.proof_submitted, AdDealStatus.settled].includes(
                snapshot.status,
            ) && !snapshot.proofSubmittedAt
        ) {
            throw new BadRequestException('Proof timestamp required');
        }

        if (snapshot.status === AdDealStatus.settled && !snapshot.settledAt) {
            throw new BadRequestException('Settlement timestamp required');
        }

        if (snapshot.status === AdDealStatus.refunded && !snapshot.refundedAt) {
            throw new BadRequestException('Refund timestamp required');
        }

        if (snapshot.status === AdDealStatus.disputed && !snapshot.disputedAt) {
            throw new BadRequestException('Dispute timestamp required');
        }
    }

    private assertTransition(from: AdDealStatus, to: AdDealStatus) {
        if (from === to) {
            return;
        }

        const allowed = AD_DEAL_TRANSITIONS[from];
        if (!allowed || !allowed.has(to)) {
            throw new BadRequestException(
                `AdDeal transition invalid: ${from} -> ${to}`,
            );
        }
    }

    private static normalizeAmount(amount: Prisma.Decimal | string) {
        const normalized = new Prisma.Decimal(amount).toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
        );
        const decimals = normalized.decimalPlaces();
        if (decimals > 2) {
            throw new BadRequestException('AdDeal amount precision invalid');
        }
        return normalized;
    }
}

export function assertAdDealTransition(params: {
    from: AdDealStatus;
    to: AdDealStatus;
}) {
    if (params.from === params.to) {
        return;
    }
    const allowed = AD_DEAL_TRANSITIONS[params.from];
    if (!allowed || !allowed.has(params.to)) {
        throw new BadRequestException(
            `AdDeal transition invalid: ${params.from} -> ${params.to}`,
        );
    }
}