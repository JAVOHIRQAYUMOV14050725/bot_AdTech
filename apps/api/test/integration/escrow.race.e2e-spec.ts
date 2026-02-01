import { Test } from '@nestjs/testing';
import { Prisma, EscrowStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';

import {
    createCampaignTargetScenario,
    seedKillSwitches,
} from '../utils/test-helpers';

describe('Escrow race condition – RELEASE & REFUND', () => {
    let prisma: PrismaService;
    let escrowService: EscrowService;
    let paymentsService: PaymentsService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                KillSwitchService,
                PaymentsService,
                EscrowService,
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn() },
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

        prisma = moduleRef.get(PrismaService);
        escrowService = moduleRef.get(EscrowService);
        paymentsService = moduleRef.get(PaymentsService);

        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    describe('RELEASE race', () => {
        it('allows only ONE release under parallel calls', async () => {
            await seedKillSwitches(prisma, {
                new_escrows: true,
                payouts: true,
            });

            const scenario = await createCampaignTargetScenario({
                prisma,
                advertiserBalance: new Prisma.Decimal(100),
                publisherBalance: new Prisma.Decimal(0),
                price: new Prisma.Decimal(25),
            });

            await paymentsService.holdEscrow(scenario.target.id);

            await prisma.campaignTarget.update({
                where: { id: scenario.target.id },
                data: { status: 'approved' },
            });


            await prisma.postJob.update({
                where: { id: scenario.postJob.id },
                data: { status: 'success' },
            });

            const results = await Promise.allSettled(
                Array.from({ length: 5 }).map(() =>
                    escrowService.release(scenario.target.id, {
                        actor: 'system',
                    }),
                ),
            );

            const released = results.filter(
                r =>
                    r.status === 'fulfilled' &&
                    r.value?.ok === true &&
                    !r.value?.alreadyReleased,
            );

            expect(released.length).toBe(1);

            const finalEscrow = await prisma.escrow.findUnique({
                where: { campaignTargetId: scenario.target.id },
            });

            expect(finalEscrow?.status).toBe(EscrowStatus.released);
        });
    });

    describe('REFUND race', () => {
        it('allows only ONE refund under parallel calls', async () => {
            await seedKillSwitches(prisma, {
                new_escrows: true,
            });

            const scenario = await createCampaignTargetScenario({
                prisma,
                advertiserBalance: new Prisma.Decimal(100),
                publisherBalance: new Prisma.Decimal(0),
                price: new Prisma.Decimal(30),
            });

            await paymentsService.holdEscrow(scenario.target.id);

            await prisma.campaignTarget.update({
                where: { id: scenario.target.id },
                data: { status: 'approved' },
            });


            await prisma.postJob.update({
                where: { id: scenario.postJob.id },
                data: { status: 'failed' },
            });

            const results = await Promise.allSettled(
                Array.from({ length: 5 }).map(() =>
                    escrowService.refund(scenario.target.id, {
                        actor: 'system',
                        reason: 'race-test',
                    }),
                ),
            );

            const refunded = results.filter(
                r =>
                    r.status === 'fulfilled' &&
                    r.value?.ok === true &&
                    !r.value?.alreadyRefunded,
            );

            expect(refunded.length).toBe(1);

            const finalEscrow = await prisma.escrow.findUnique({
                where: { campaignTargetId: scenario.target.id },
            });

            expect(finalEscrow?.status).toBe(EscrowStatus.refunded);
        });
    });
});
