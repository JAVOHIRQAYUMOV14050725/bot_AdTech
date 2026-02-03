import { EscrowStatus } from '@prisma/client';
import { assertEscrowTransition } from '@/modules/lifecycle/lifecycle';
import { TransitionActor } from '@/modules/domain/contracts';

describe('Escrow transitions', () => {
    it('rejects invalid escrow transitions', () => {
        expect(() =>
            assertEscrowTransition({
                escrowId: 'escrow-1',
                from: EscrowStatus.held,
                to: EscrowStatus.refunded,
                actor: TransitionActor.publisher,
            }),
        ).toThrow();
    });
});