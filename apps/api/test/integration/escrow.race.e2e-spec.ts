import { Test } from '@nestjs/testing';
import { EscrowService } from '@/modules/payments/escrow.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EscrowStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';

describe('Escrow race condition – RELEASE & REFUND', () => {
    let escrowService: EscrowService;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                KillSwitchService,
                PaymentsService,
                EscrowService,

                // 🔧 REQUIRED MOCKS
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(),
                    },
                },
                {
                    provide: 'LOGGER',
                    useValue: {
                        log: jest.fn(),
                        warn: jest.fn(),
                        error: jest.fn(),
                        debug: jest.fn(),
                    } satisfies LoggerService,
                },
            ],
        }).compile();

        escrowService = moduleRef.get(EscrowService);
        prisma = moduleRef.get(PrismaService);

        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    describe('RELEASE race', () => {
        it('allows only ONE release under parallel calls', async () => {
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

            // 🔐 EXACTLY ONE real transition
            expect(released.length).toBe(1);

            const finalEscrow = await prisma.escrow.findUnique({
                where: { campaignTargetId },
            });

            expect(finalEscrow?.status).toBe(EscrowStatus.released);
        });
    });

    describe('REFUND race', () => {
        it('allows only ONE refund under parallel calls', async () => {
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

            // 🔐 EXACTLY ONE real transition
            expect(refunded.length).toBe(1);

            const finalEscrow = await prisma.escrow.findUnique({
                where: { campaignTargetId },
            });

            expect(finalEscrow?.status).toBe(EscrowStatus.refunded);
        });
    });
});
