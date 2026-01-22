import { Prisma } from '@prisma/client';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import {
    createCampaignTargetScenario,
    resetDatabase,
    seedKillSwitches,
} from '../utils/test-helpers';
import { PrismaService } from '@/prisma/prisma.service';

describe('Kill switch integration', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let escrowService: EscrowService;

    beforeAll(async () => {
        prisma = new PrismaService();
        await prisma.$connect();
        const killSwitchService = new KillSwitchService(prisma);
        paymentsService = new PaymentsService(prisma, killSwitchService);
        escrowService = new EscrowService(prisma, paymentsService, killSwitchService);
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

        try {
            await paymentsService.holdEscrow(scenario.target.id);
        } catch {
            // Expected: kill switch blocks operation.
        }

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        expect(escrow).toBeNull();
    });

    it('blocks escrow release when payouts kill switch is OFF', async () => {
        await seedKillSwitches(prisma, { new_escrows: true, payouts: false });

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

        try {
            await escrowService.release(scenario.target.id, { actor: 'worker' });
        } catch {
            // Expected: kill switch blocks operation.
        }

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