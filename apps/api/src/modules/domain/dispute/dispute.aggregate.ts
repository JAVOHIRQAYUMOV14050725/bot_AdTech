import { BadRequestException } from '@nestjs/common';

import {
    DisputeResolution,
    DisputeSnapshot,
    DisputeStatus,
} from './dispute.types';

type TransitionMap = Record<DisputeStatus, Set<DisputeStatus>>;

const DISPUTE_TRANSITIONS: TransitionMap = {
    [DisputeStatus.open]: new Set([DisputeStatus.resolved]),
    [DisputeStatus.resolved]: new Set([]),
};

export class Dispute {
    private constructor(private readonly snapshot: DisputeSnapshot) {
        this.assertInvariant(snapshot);
    }

    static open(params: {
        id: string;
        adDealId: string;
        openedBy: string;
        reason: string;
        createdAt?: Date;
    }) {
        return new Dispute({
            id: params.id,
            adDealId: params.adDealId,
            openedBy: params.openedBy,
            reason: params.reason,
            status: DisputeStatus.open,
            createdAt: params.createdAt ?? new Date(),
        });
    }

    static rehydrate(snapshot: DisputeSnapshot) {
        return new Dispute(snapshot);
    }

    resolve(params: {
        resolution: DisputeResolution;
        resolvedBy: string;
        resolvedAt?: Date;
    }) {
        return this.transition(DisputeStatus.resolved, {
            resolution: params.resolution,
            resolvedBy: params.resolvedBy,
            resolvedAt: params.resolvedAt ?? new Date(),
        });
    }

    toSnapshot() {
        return { ...this.snapshot };
    }

    private transition(status: DisputeStatus, updates: Partial<DisputeSnapshot>) {
        this.assertTransition(this.snapshot.status, status);
        const nextSnapshot: DisputeSnapshot = {
            ...this.snapshot,
            ...updates,
            status,
        };
        return new Dispute(nextSnapshot);
    }

    private assertInvariant(snapshot: DisputeSnapshot) {
        if (!snapshot.id || !snapshot.adDealId) {
            throw new BadRequestException('Dispute requires identity fields');
        }
        if (!snapshot.openedBy) {
            throw new BadRequestException('Dispute requires opener');
        }
        if (!snapshot.reason || snapshot.reason.trim().length === 0) {
            throw new BadRequestException('Dispute reason required');
        }
        if (snapshot.status === DisputeStatus.resolved) {
            if (!snapshot.resolution) {
                throw new BadRequestException('Dispute resolution required');
            }
            if (!snapshot.resolvedBy || !snapshot.resolvedAt) {
                throw new BadRequestException('Dispute resolution audit required');
            }
        }
    }

    private assertTransition(from: DisputeStatus, to: DisputeStatus) {
        if (from === to) {
            return;
        }
        const allowed = DISPUTE_TRANSITIONS[from];
        if (!allowed || !allowed.has(to)) {
            throw new BadRequestException(
                `Dispute transition invalid: ${from} -> ${to}`,
            );
        }
    }
}