import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DealState } from '@/modules/domain/contracts';

import { isAdDealTransitionDefined } from './addeal.lifecycle';

import { AdDealSnapshot } from './addeal.types';

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
            status: DealState.created,
            createdAt,
        });
    }

    static rehydrate(snapshot: AdDealSnapshot) {
        return new AdDeal(snapshot);
    }

    fund(fundedAt?: Date) {
        return this.transition(DealState.funded, {
            fundedAt: fundedAt ?? new Date(),
        });
    }

    lockEscrow(lockedAt?: Date) {
        return this.transition(DealState.escrow_locked, {
            lockedAt: lockedAt ?? new Date(),
        });
    }

    accept(acceptedAt?: Date) {
        return this.transition(DealState.accepted, {
            acceptedAt: acceptedAt ?? new Date(),
        });
    }

    submitProof(submittedAt?: Date) {
        return this.transition(DealState.proof_submitted, {
            proofSubmittedAt: submittedAt ?? new Date(),
        });
    }

    settle(settledAt?: Date) {
        return this.transition(DealState.settled, {
            settledAt: settledAt ?? new Date(),
        });
    }

    refund(refundedAt?: Date) {
        return this.transition(DealState.refunded, {
            refundedAt: refundedAt ?? new Date(),
        });
    }

    dispute(disputedAt?: Date) {
        return this.transition(DealState.disputed, {
            disputedAt: disputedAt ?? new Date(),
        });
    }

    toSnapshot(): AdDealSnapshot {
        return { ...this.snapshot };
    }

    private transition(status: DealState, updates: Partial<AdDealSnapshot>) {
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

        if (snapshot.status !== DealState.created && !snapshot.fundedAt) {
            throw new BadRequestException(
                'AdDeal funding timestamp required after funding',
            );
        }

        if (
            [
                DealState.escrow_locked,
                DealState.accepted,
                DealState.proof_submitted,
                DealState.settled,
                DealState.disputed,
            ].includes(snapshot.status) && !snapshot.lockedAt
        ) {
            throw new BadRequestException(
                'AdDeal escrow lock timestamp required after lock',
            );
        }

        if (
            [
                DealState.accepted,
                DealState.proof_submitted,
                DealState.settled,
            ].includes(snapshot.status) && !snapshot.acceptedAt
        ) {
            throw new BadRequestException('AdDeal accept timestamp required');
        }

        if (
            [DealState.proof_submitted, DealState.settled].includes(
                snapshot.status,
            ) && !snapshot.proofSubmittedAt
        ) {
            throw new BadRequestException('Proof timestamp required');
        }

        if (snapshot.status === DealState.settled && !snapshot.settledAt) {
            throw new BadRequestException('Settlement timestamp required');
        }

        if (snapshot.status === DealState.refunded && !snapshot.refundedAt) {
            throw new BadRequestException('Refund timestamp required');
        }

        if (snapshot.status === DealState.disputed && !snapshot.disputedAt) {
            throw new BadRequestException('Dispute timestamp required');
        }
    }

    private assertTransition(from: DealState, to: DealState) {
        if (from === to) {
            return;
        }

        if (!isAdDealTransitionDefined(from, to)) {
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