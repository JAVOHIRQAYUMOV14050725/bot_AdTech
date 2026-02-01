import { Test } from '@nestjs/testing';
import { EscrowService } from '../../src/modules/payments/escrow.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EscrowStatus } from '@prisma/client';

describe('Escrow race condition – RELEASE', () => {
    let escrowService: EscrowService;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [EscrowService, PrismaService],
        }).compile();

        escrowService = moduleRef.get(EscrowService);
        prisma = moduleRef.get(PrismaService);
    });

    it('should allow only ONE release under parallel calls', async () => {
        const campaignTargetId = 'test-ct-race-release';

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId },
        });

        expect(escrow?.status).toBe(EscrowStatus.held);

        const results = await Promise.allSettled(
            Array.from({ length: 5 }).map(() =>
                escrowService.release(campaignTargetId, {
                    actor: 'system',
                    correlationId: 'race-test-release',
                }),
            ),
        );

        const fulfilled = results.filter(r => r.status === 'fulfilled');

        const released = fulfilled.filter(
            r =>
                'value' in r &&
                r.value?.ok === true &&
                !r.value?.alreadyReleased,
        );

        expect(released.length).toBe(1);

        const finalEscrow = await prisma.escrow.findUnique({
            where: { campaignTargetId },
        });

        expect(finalEscrow?.status).toBe(EscrowStatus.released);
    });
});

describe('Escrow race condition – REFUND', () => {
    let escrowService: EscrowService;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [EscrowService, PrismaService],
        }).compile();

        escrowService = moduleRef.get(EscrowService);
        prisma = moduleRef.get(PrismaService);
    });

    it('should allow only ONE refund under parallel calls', async () => {
        const campaignTargetId = 'test-ct-race-refund';

        const results = await Promise.allSettled(
            Array.from({ length: 5 }).map(() =>
                escrowService.refund(campaignTargetId, {
                    actor: 'system',
                    reason: 'race-test',
                    correlationId: 'race-test-refund',
                }),
            ),
        );

        const fulfilled = results.filter(r => r.status === 'fulfilled');

        const refunded = fulfilled.filter(
            r =>
                'value' in r &&
                r.value?.ok === true &&
                !r.value?.alreadyRefunded,
        );

        expect(refunded.length).toBe(1);

        const finalEscrow = await prisma.escrow.findUnique({
            where: { campaignTargetId },
        });

        expect(finalEscrow?.status).toBe(EscrowStatus.refunded);
    });
});
