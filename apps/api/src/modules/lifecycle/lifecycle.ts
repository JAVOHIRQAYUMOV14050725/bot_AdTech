import {
    BadRequestException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import {
    CampaignStatus,
    CampaignTargetStatus,
    EscrowStatus,
    PostJobStatus,
} from '@prisma/client';

export type TransitionActor = 'system' | 'worker' | 'admin';

type TransitionRule = {
    actors: TransitionActor[];
};

type TransitionMap<S extends string> = Record<
    S,
    Partial<Record<S, TransitionRule>>
>;

const logger = new Logger('LifecycleFSM');

const campaignTransitions: TransitionMap<CampaignStatus> = {
    draft: {
        active: { actors: ['admin', 'system'] },
        cancelled: { actors: ['admin'] },
    },
    active: {
        paused: { actors: ['admin'] },
        completed: { actors: ['admin', 'system'] },
        cancelled: { actors: ['admin'] },
    },
    paused: {
        active: { actors: ['admin'] },
        cancelled: { actors: ['admin'] },
    },
    completed: {},
    cancelled: {},
};

const campaignTargetTransitions: TransitionMap<CampaignTargetStatus> = {
    pending: {
        posted: { actors: ['worker', 'system', 'admin'] },
        failed: { actors: ['worker', 'system'] },
        refunded: { actors: ['worker', 'system', 'admin'] },
    },
    posted: {},
    failed: {
        refunded: { actors: ['worker', 'system', 'admin'] },
    },
    refunded: {},
};

const postJobTransitions: TransitionMap<PostJobStatus> = {
    queued: {
        success: { actors: ['worker', 'system'] },
        failed: { actors: ['worker', 'system'] },
    },
    success: {},
    failed: {
        queued: { actors: ['admin'] },
    },
};

const escrowTransitions: TransitionMap<EscrowStatus> = {
    held: {
        released: { actors: ['worker', 'system', 'admin'] },
        refunded: { actors: ['worker', 'system', 'admin'] },
    },
    released: {},
    refunded: {},
};

type TransitionPayload<S extends string> = {
    entity: string;
    id: string;
    from: S;
    to: S;
    actor: TransitionActor;
    transitions: TransitionMap<S>;
    correlationId?: string;
};

function assertTransition<S extends string>({
    entity,
    id,
    from,
    to,
    actor,
    transitions,
    correlationId,
}: TransitionPayload<S>) {
    if (from === to) {
        return { noop: true };
    }

    const rule = transitions[from]?.[to];

    if (!rule) {
        logger.error(
            `[FSM] Forbidden ${entity} transition ${from} -> ${to} (id=${id}, actor=${actor})`,
        );
        throw new ConflictException(
            `${entity} ${id} cannot transition from ${from} to ${to}`,
        );
    }

    if (!rule.actors.includes(actor)) {
        logger.error(
            `[FSM] Actor ${actor} not allowed for ${entity} transition ${from} -> ${to} (id=${id})`,
        );
        throw new ConflictException(
            `${entity} ${id} transition ${from} -> ${to} is not allowed for actor ${actor}`,
        );
    }

    logger.log(
        JSON.stringify({
            event: 'state_transition',
            entity,
            id,
            from,
            to,
            actor,
            correlationId: correlationId ?? null,
        }),
    );

    return { noop: false };
}

export function assertCampaignTransition(params: {
    campaignId: string;
    from: CampaignStatus;
    to: CampaignStatus;
    actor: TransitionActor;
    correlationId?: string;
}) {
    return assertTransition({
        entity: 'Campaign',
        id: params.campaignId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        transitions: campaignTransitions,
        correlationId: params.correlationId,
    });
}

export function assertCampaignTargetTransition(params: {
    campaignTargetId: string;
    from: CampaignTargetStatus;
    to: CampaignTargetStatus;
    actor: TransitionActor;
    correlationId?: string;
}) {
    return assertTransition({
        entity: 'CampaignTarget',
        id: params.campaignTargetId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        transitions: campaignTargetTransitions,
        correlationId: params.correlationId,
    });
}

export function assertPostJobTransition(params: {
    postJobId: string;
    from: PostJobStatus;
    to: PostJobStatus;
    actor: TransitionActor;
    correlationId?: string;
}) {
    return assertTransition({
        entity: 'PostJob',
        id: params.postJobId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        transitions: postJobTransitions,
        correlationId: params.correlationId,
    });
}

export function assertEscrowTransition(params: {
    escrowId: string;
    from: EscrowStatus;
    to: EscrowStatus;
    actor: TransitionActor;
    correlationId?: string;
}) {
    return assertTransition({
        entity: 'Escrow',
        id: params.escrowId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        transitions: escrowTransitions,
        correlationId: params.correlationId,
    });
}

export function assertEscrowCampaignTargetInvariant(params: {
    campaignTargetId: string;
    escrowStatus: EscrowStatus;
    campaignTargetStatus: CampaignTargetStatus;
}) {
    const { campaignTargetId, escrowStatus, campaignTargetStatus } = params;

    if (escrowStatus === 'released' && campaignTargetStatus !== 'posted') {
        logger.error(
            `[INVARIANT] Escrow released but CampaignTarget=${campaignTargetId} is ${campaignTargetStatus}`,
        );
        throw new ConflictException(
            `Escrow released requires CampaignTarget ${campaignTargetId} to be posted`,
        );
    }

    if (escrowStatus === 'refunded' && campaignTargetStatus !== 'refunded') {
        logger.error(
            `[INVARIANT] Escrow refunded but CampaignTarget=${campaignTargetId} is ${campaignTargetStatus}`,
        );
        throw new ConflictException(
            `Escrow refunded requires CampaignTarget ${campaignTargetId} to be refunded`,
        );
    }
}

export function assertPostJobOutcomeForEscrow(params: {
    campaignTargetId: string;
    postJobStatus: PostJobStatus | null;
    action: 'release' | 'refund';
    actor: TransitionActor;
}) {
    const { campaignTargetId, postJobStatus, action, actor } = params;

    if (actor === 'admin') {
        return;
    }

    if (!postJobStatus) {
        return;
    }

    if (action === 'release' && postJobStatus !== 'success') {
        logger.error(
            `[INVARIANT] Escrow release blocked: PostJob is ${postJobStatus} (campaignTarget=${campaignTargetId})`,
        );
        throw new ConflictException(
            `Escrow release requires PostJob success for campaignTarget ${campaignTargetId}`,
        );
    }

    if (action === 'refund') {
        if (postJobStatus === 'success') {
            logger.error(
                `[INVARIANT] Escrow refund blocked: PostJob is success (campaignTarget=${campaignTargetId})`,
            );
            throw new ConflictException(
                `Escrow refund requires PostJob failed or unresolved for campaignTarget ${campaignTargetId}`,
            );
        }

        if (actor === 'worker' && postJobStatus !== 'failed') {
            logger.error(
                `[INVARIANT] Worker refund blocked: PostJob is ${postJobStatus} (campaignTarget=${campaignTargetId})`,
            );
            throw new ConflictException(
                `Worker refund requires PostJob failed for campaignTarget ${campaignTargetId}`,
            );
        }
    }
}

export function assertCampaignTargetExists(
    campaignTargetId: string,
    exists: boolean,
) {
    if (!exists) {
        logger.error(
            `[INVARIANT] Missing CampaignTarget for campaignTargetId=${campaignTargetId}`,
        );
        throw new BadRequestException('Campaign target not found');
    }
}
