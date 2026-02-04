import { PaymentsService } from '@/modules/payments/payments.service';
import { Prisma } from '@prisma/client';

describe('PaymentsService unit', () => {
    const clickPaymentService = { verifyWebhookSignature: jest.fn().mockReturnValue(false) };
    const paymentsService = new PaymentsService(
        {} as never,
        {} as never,
        { get: jest.fn() } as never,
        clickPaymentService as never,
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

    it('delegates click signature verification', () => {
        const payload = { sign: 'bad' };
        expect(paymentsService.verifyClickSignature(payload)).toBe(false);
    });
});
