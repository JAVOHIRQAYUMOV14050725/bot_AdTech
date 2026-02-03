import { DealState, LedgerReason, TransitionActor } from '@/modules/domain/contracts';
import { assertAdDealMoneyMovement, assertAdDealTransition } from '@/modules/domain/addeal/addeal.lifecycle';

describe('AdDeal money movement invariants', () => {
    it('requires commission on settlement', () => {
        const transition = assertAdDealTransition({
            adDealId: 'deal-1',
            from: DealState.proof_submitted,
            to: DealState.settled,
            actor: TransitionActor.admin,
        });
        if (transition.noop) {
            throw new Error('Transition should not be noop');
        }

        expect(() =>
            assertAdDealMoneyMovement({
                adDealId: 'deal-1',
                rule: transition.rule,
                reasons: [LedgerReason.payout],
            }),
        ).toThrow('commission');

        expect(() =>
            assertAdDealMoneyMovement({
                adDealId: 'deal-1',
                rule: transition.rule,
                reasons: [LedgerReason.payout, LedgerReason.commission],
            }),
        ).not.toThrow();
    });
});