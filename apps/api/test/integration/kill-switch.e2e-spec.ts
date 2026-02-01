import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';

import {
    createCampaignTargetScenario,
    resetDatabase,
    seedKillSwitches,
} from '../utils/test-helpers';

describe('Kill switch integration', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let escrowService: EscrowService;

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

        prisma = moduleRef.get(PrismaService);
        paymentsService = moduleRef.get(PaymentsService);
        escrowService = moduleRef.get(EscrowService);

        await prisma.$connect();
    });

    beforeEach(async () => {
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('blocks escrow hold when kill switch is OFF', async () => {
        await seedKillSwitches(prisma, { new_escrows: false });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(80),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(20),
        });

        await expect(
            paymentsService.holdEscrow(scenario.target.id),
        ).rejects.toBeDefined();

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        expect(escrow).toBeNull();
    });

    it('blocks escrow release when payouts kill switch is OFF', async () => {
        await seedKillSwitches(prisma, {
            new_escrows: true,
            payouts: false,
        });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(120),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(45),
        });

        await paymentsService.holdEscrow(scenario.target.id);

        await prisma.postJob.update({
            where: { id: scenario.postJob.id },
            data: { status: 'success' },
        });

        await expect(
            escrowService.release(scenario.target.id, { actor: 'worker' }),
        ).rejects.toBeDefined();

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        const target = await prisma.campaignTarget.findUnique({
            where: { id: scenario.target.id },
        });

        expect(escrow?.status).toBe('held');
        expect(target?.status).toBe('pending');
    });
});
