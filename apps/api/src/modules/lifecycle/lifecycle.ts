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
import { TransitionActor } from '@/modules/domain/contracts';

type TransitionRule = {
    actors: TransitionActor[];
};

type TransitionMap<S extends string> = Record<
    S,
    Partial<Record<S, TransitionRule>>
>;

const logger = new Logger('LifecycleFSM');

const campaignTransitions: TransitionMap<CampaignStatus> = {
    [CampaignStatus.draft]: {
        [CampaignStatus.active]: {
            actors: [TransitionActor.advertiser, TransitionActor.admin, TransitionActor.system],
        },
        [CampaignStatus.cancelled]: { actors: [TransitionActor.admin] },
    },
    [CampaignStatus.active]: {
        [CampaignStatus.paused]: {
            actors: [TransitionActor.advertiser, TransitionActor.admin],
        },
        [CampaignStatus.completed]: {
            actors: [TransitionActor.admin, TransitionActor.system],
        },
        [CampaignStatus.cancelled]: {
            actors: [TransitionActor.advertiser, TransitionActor.admin],
        },
    },
    [CampaignStatus.paused]: {
        [CampaignStatus.active]: {
            actors: [TransitionActor.advertiser, TransitionActor.admin],
        },
        [CampaignStatus.cancelled]: { actors: [TransitionActor.admin] },
    },
    [CampaignStatus.completed]: {},
    [CampaignStatus.cancelled]: {},
};

const campaignTargetTransitions: TransitionMap<CampaignTargetStatus> = {
    [CampaignTargetStatus.pending]: {
        [CampaignTargetStatus.submitted]: {
            actors: [TransitionActor.advertiser],
        },
    },

    [CampaignTargetStatus.submitted]: {
        [CampaignTargetStatus.accepted]: {
            actors: [TransitionActor.publisher], // ✅ ONLY publisher
        },
        [CampaignTargetStatus.rejected]: {
            actors: [TransitionActor.publisher, TransitionActor.admin],
        },
    },

    [CampaignTargetStatus.accepted]: {
        [CampaignTargetStatus.approved]: {
            actors: [TransitionActor.admin],
        },
        [CampaignTargetStatus.rejected]: {
            actors: [TransitionActor.admin],
        },
    },

    [CampaignTargetStatus.approved]: {
        [CampaignTargetStatus.posted]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
        [CampaignTargetStatus.failed]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
    },

    [CampaignTargetStatus.failed]: {
        [CampaignTargetStatus.refunded]: {
            actors: [
                TransitionActor.worker,
                TransitionActor.system,
                TransitionActor.admin,
            ],
        },
    },

    [CampaignTargetStatus.posted]: {},
    [CampaignTargetStatus.refunded]: {},
    [CampaignTargetStatus.rejected]: {},
};


const postJobTransitions: TransitionMap<PostJobStatus> = {
    [PostJobStatus.queued]: {
        [PostJobStatus.sending]: { actors: [TransitionActor.worker] },
        [PostJobStatus.success]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
        [PostJobStatus.failed]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
    },
    [PostJobStatus.sending]: {
        [PostJobStatus.success]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
        [PostJobStatus.failed]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
        [PostJobStatus.queued]: {
            actors: [TransitionActor.worker, TransitionActor.system],
        },
    },
    [PostJobStatus.success]: {},
    [PostJobStatus.failed]: {
        [PostJobStatus.queued]: { actors: [TransitionActor.admin] },
    },
};

const escrowTransitions: TransitionMap<EscrowStatus> = {
    [EscrowStatus.held]: {
        [EscrowStatus.releasing]: {
            actors: [
                TransitionActor.worker,
                TransitionActor.system,
                TransitionActor.admin,
            ],
        },
        [EscrowStatus.refunding]: {
            actors: [
                TransitionActor.worker,
                TransitionActor.system,
                TransitionActor.admin,
            ],
        },
    },

    [EscrowStatus.releasing]: {
        [EscrowStatus.released]: {
            actors: [
                TransitionActor.worker,
                TransitionActor.system,
                TransitionActor.admin,
            ],
        },
    },

    [EscrowStatus.refunding]: {
        [EscrowStatus.refunded]: {
            actors: [
                TransitionActor.worker,
                TransitionActor.system,
                TransitionActor.admin,
            ],
        },
    },

    [EscrowStatus.released]: {},
    [EscrowStatus.refunded]: {},
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
        logger.error({
            event: 'invalid_state_transition',
            entity,
            id,
            from,
            to,
            actor,
            correlationId: correlationId ?? null,
        },
            'LifecycleFSM',
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

    logger.log({
        event: 'state_transition',
        entity,
        id,
        from,
        to,
        actor,
        correlationId: correlationId ?? null,
    },
        'LifecycleFSM',
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

    if (
        escrowStatus === EscrowStatus.released
        && campaignTargetStatus !== CampaignTargetStatus.posted
    ) {
        logger.error(
            `[INVARIANT] Escrow released but CampaignTarget=${campaignTargetId} is ${campaignTargetStatus}`,
        );
        throw new ConflictException(
            `Escrow released requires CampaignTarget ${campaignTargetId} to be posted`,
        );
    }

    if (
        escrowStatus === EscrowStatus.refunded
        && campaignTargetStatus !== CampaignTargetStatus.refunded
    ) {
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

    if (actor === TransitionActor.admin) {
        return;
    }

    if (!postJobStatus) {
        return;
    }

    if (action === 'release' && postJobStatus !== PostJobStatus.success) {
        logger.error(
            `[INVARIANT] Escrow release blocked: PostJob is ${postJobStatus} (campaignTarget=${campaignTargetId})`,
        );
        throw new ConflictException(
            `Escrow release requires PostJob success for campaignTarget ${campaignTargetId}`,
        );
    }

    if (action === 'refund') {
        if (postJobStatus === PostJobStatus.success) {
            logger.error(
                `[INVARIANT] Escrow refund blocked: PostJob is success (campaignTarget=${campaignTargetId})`,
            );
            throw new ConflictException(
                `Escrow refund requires PostJob failed or unresolved for campaignTarget ${campaignTargetId}`,
            );
        }

        if (actor === TransitionActor.worker && postJobStatus !== PostJobStatus.failed) {
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