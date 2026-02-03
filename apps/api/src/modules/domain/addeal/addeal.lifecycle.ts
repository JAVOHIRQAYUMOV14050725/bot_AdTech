import { ConflictException, Logger } from '@nestjs/common';

import {
    DealState,
    LedgerReason,
    TransitionActor,
} from '@/modules/domain/contracts';

type MoneyMovement =
    | { type: 'none' }
    | { type: 'ledger'; required: LedgerReason[]; optional?: LedgerReason[] };

type TransitionRule = {
    actors: TransitionActor[];
    moneyMovement: MoneyMovement;
};

type TransitionMap = Record<DealState, Partial<Record<DealState, TransitionRule>>>;
type TransitionResult =
    | { noop: true; rule: null }
    | { noop: false; rule: TransitionRule };

const logger = new Logger('AdDealLifecycle');

const NO_MONEY_MOVEMENT: MoneyMovement = { type: 'none' };

const AD_DEAL_TRANSITIONS: TransitionMap = {
    [DealState.created]: {
        [DealState.funded]: {
            actors: [TransitionActor.payment_provider, TransitionActor.system],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.deposit],
            },
        },
    },
    [DealState.funded]: {
        [DealState.escrow_locked]: {
            actors: [
                TransitionActor.advertiser,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.escrow_hold],
            },
        },
    },
    [DealState.escrow_locked]: {
        [DealState.accepted]: {
            actors: [
                TransitionActor.publisher,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: NO_MONEY_MOVEMENT,
        },
        [DealState.refunded]: {
            actors: [
                TransitionActor.advertiser,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.refund],
            },
        },
        [DealState.disputed]: {
            actors: [
                TransitionActor.advertiser,
                TransitionActor.publisher,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: NO_MONEY_MOVEMENT,
        },
    },
    [DealState.accepted]: {
        [DealState.proof_submitted]: {
            actors: [
                TransitionActor.publisher,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: NO_MONEY_MOVEMENT,
        },
        [DealState.disputed]: {
            actors: [
                TransitionActor.advertiser,
                TransitionActor.publisher,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: NO_MONEY_MOVEMENT,
        },
    },
    [DealState.proof_submitted]: {
        [DealState.settled]: {
            actors: [TransitionActor.admin, TransitionActor.system],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.payout, LedgerReason.commission],
            },
        },
        [DealState.refunded]: {
            actors: [TransitionActor.admin, TransitionActor.system],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.refund],
            },
        },
        [DealState.disputed]: {
            actors: [
                TransitionActor.advertiser,
                TransitionActor.publisher,
                TransitionActor.admin,
                TransitionActor.system,
            ],
            moneyMovement: NO_MONEY_MOVEMENT,
        },
    },
    [DealState.settled]: {},
    [DealState.refunded]: {},
    [DealState.disputed]: {
        [DealState.settled]: {
            actors: [TransitionActor.admin, TransitionActor.system],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.payout, LedgerReason.commission],
            },
        },
        [DealState.refunded]: {
            actors: [TransitionActor.admin, TransitionActor.system],
            moneyMovement: {
                type: 'ledger',
                required: [LedgerReason.refund],
            },
        },
    },
};

export function isAdDealTransitionDefined(from: DealState, to: DealState) {
    return Boolean(AD_DEAL_TRANSITIONS[from]?.[to]);
}

export function assertAdDealTransition(params: {
    adDealId: string;
    from: DealState;
    to: DealState;
    actor: TransitionActor;
    correlationId?: string;
}): TransitionResult {
    if (params.from === params.to) {
        return { noop: true, rule: null };
    }

    const rule = AD_DEAL_TRANSITIONS[params.from]?.[params.to];

    if (!rule) {
        logger.error({
            event: 'invalid_addeal_transition',
            adDealId: params.adDealId,
            from: params.from,
            to: params.to,
            actor: params.actor,
            correlationId: params.correlationId ?? null,
        });
        throw new ConflictException(
            `AdDeal ${params.adDealId} cannot transition from ${params.from} to ${params.to}`,
        );
    }

    if (!rule.actors.includes(params.actor)) {
        logger.error({
            event: 'addeal_transition_actor_denied',
            adDealId: params.adDealId,
            from: params.from,
            to: params.to,
            actor: params.actor,
            correlationId: params.correlationId ?? null,
        });
        throw new ConflictException(
            `AdDeal ${params.adDealId} transition ${params.from} -> ${params.to} not allowed for actor ${params.actor}`,
        );
    }

    logger.log({
        event: 'addeal_transition',
        adDealId: params.adDealId,
        from: params.from,
        to: params.to,
        actor: params.actor,
        correlationId: params.correlationId ?? null,
    });

    return { noop: false, rule };
}

export function assertAdDealMoneyMovement(params: {
    adDealId: string;
    rule: TransitionRule;
    reasons: LedgerReason[];
}) {
    const { rule, reasons } = params;

    if (rule.moneyMovement.type === 'none') {
        if (reasons.length > 0) {
            throw new ConflictException(
                `AdDeal ${params.adDealId} transition requires no money movement`,
            );
        }
        return;
    }

    const required = new Set(rule.moneyMovement.required);
    const optional = new Set(rule.moneyMovement.optional ?? []);
    const provided = new Set(reasons);

    for (const reason of required) {
        if (!provided.has(reason)) {
            throw new ConflictException(
                `AdDeal ${params.adDealId} missing required ledger reason ${reason}`,
            );
        }
    }

    for (const reason of provided) {
        if (!required.has(reason) && !optional.has(reason)) {
            throw new ConflictException(
                `AdDeal ${params.adDealId} unexpected ledger reason ${reason}`,
            );
        }
    }
}
