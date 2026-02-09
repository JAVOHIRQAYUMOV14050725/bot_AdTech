import { DealState, TransitionActor } from '@/modules/domain/contracts';
import { assertAdDealTransition } from '@/modules/domain/addeal/addeal.lifecycle';

describe('AdDeal transition rules', () => {
    it('allows created -> funded for payment provider', () => {
        const transition = assertAdDealTransition({
            adDealId: 'deal-1',
            from: DealState.created,
            to: DealState.funded,
            actor: TransitionActor.payment_provider,
        });

        expect(transition.noop).toBe(false);
    });

    it('rejects created -> accepted', () => {
        expect(() =>
            assertAdDealTransition({
                adDealId: 'deal-1',
                from: DealState.created,
                to: DealState.accepted,
                actor: TransitionActor.publisher,
            }),
        ).toThrow();
    });
});
