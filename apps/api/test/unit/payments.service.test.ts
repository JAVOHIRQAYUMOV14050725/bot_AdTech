import { PaymentsService } from '@/modules/payments/payments.service';
import { Prisma } from '@prisma/client';

describe('PaymentsService unit', () => {
    const paymentsService = new PaymentsService(
        {} as never,
        {} as never,
        { get: jest.fn() } as never,
        { verifyWebhookSignature: jest.fn() } as never,
        { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
    );

    it('enforces commission invariant', () => {
        expect(() =>
            paymentsService.calculateCommissionSplit(
                new Prisma.Decimal(100),
                { amount: new Prisma.Decimal(150), percentage: new Prisma.Decimal(0) },
            ),
        ).toThrow('Commission exceeds escrow amount');
    });

    it('rejects finalize without provider verification', async () => {
        await expect(
            paymentsService.finalizeDepositIntent({
                payload: {},
                verified: false,
            }),
        ).rejects.toThrow('Click webhook signature invalid');
    });
});
