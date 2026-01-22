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

describe('Payments integration (wallet/ledger + escrow)', () => {
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

    it('records deposits and preserves wallet = ledger invariant', async () => {
        const user = await prisma.user.create({
            data: {
                telegramId: BigInt(7001),
                role: 'advertiser',
                status: 'active',
            },
        });

        const wallet = await prisma.wallet.create({
            data: {
                userId: user.id,
                balance: new Prisma.Decimal(0),
                currency: 'USD',
            },
        });

        await paymentsService.deposit(user.id, new Prisma.Decimal(50));

        const dbWallet = await prisma.wallet.findUnique({
            where: { id: wallet.id },
            select: { balance: true },
        });

        const ledgerSum = await prisma.ledgerEntry.aggregate({
            where: { walletId: wallet.id },
            _sum: { amount: true },
        });

        expect(dbWallet?.balance?.toString()).toBe('50');
        expect(new Prisma.Decimal(ledgerSum._sum.amount ?? 0).toString()).toBe('50');
    });

    it('holds escrow and debits advertiser wallet with matching ledger entry', async () => {
        await seedKillSwitches(prisma, { new_escrows: true });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(200),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(75),
        });

        await paymentsService.holdEscrow(scenario.target.id);

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        const advertiserWallet = await prisma.wallet.findUnique({
            where: { id: scenario.advertiser.wallet.id },
            select: { balance: true },
        });

        const holdLedger = await prisma.ledgerEntry.findFirst({
            where: {
                walletId: scenario.advertiser.wallet.id,
                reason: 'escrow_hold',
                referenceId: scenario.target.id,
            },
        });

        expect(escrow?.status).toBe('held');
        expect(advertiserWallet?.balance?.toString()).toBe('125');
        expect(holdLedger?.amount.toString()).toBe('-75');
    });

    it('releases escrow, credits publisher, and marks target posted', async () => {
        await seedKillSwitches(prisma, { new_escrows: true, payouts: true });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(200),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(40),
        });

        await paymentsService.holdEscrow(scenario.target.id);

        await prisma.postJob.update({
            where: { id: scenario.postJob.id },
            data: { status: 'success' },
        });

        await escrowService.release(scenario.target.id, { actor: 'worker' });

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        const target = await prisma.campaignTarget.findUnique({
            where: { id: scenario.target.id },
        });

        const publisherWallet = await prisma.wallet.findUnique({
            where: { id: scenario.publisher.wallet.id },
            select: { balance: true },
        });

        const payoutLedger = await prisma.ledgerEntry.findFirst({
            where: {
                walletId: scenario.publisher.wallet.id,
                reason: 'payout',
                referenceId: scenario.target.id,
            },
        });

        expect(escrow?.status).toBe('released');
        expect(target?.status).toBe('posted');
        expect(publisherWallet?.balance?.toString()).toBe('40');
        expect(payoutLedger?.amount.toString()).toBe('40');
    });

    it('refunds escrow, credits advertiser, and marks target refunded', async () => {
        await seedKillSwitches(prisma, { new_escrows: true });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(150),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(30),
        });

        await paymentsService.holdEscrow(scenario.target.id);

        await prisma.postJob.update({
            where: { id: scenario.postJob.id },
            data: { status: 'failed' },
        });

        await escrowService.refund(scenario.target.id, { actor: 'worker' });

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        const target = await prisma.campaignTarget.findUnique({
            where: { id: scenario.target.id },
        });

        const advertiserWallet = await prisma.wallet.findUnique({
            where: { id: scenario.advertiser.wallet.id },
            select: { balance: true },
        });

        const refundLedger = await prisma.ledgerEntry.findFirst({
            where: {
                walletId: scenario.advertiser.wallet.id,
                reason: 'refund',
                referenceId: scenario.target.id,
            },
        });

        expect(escrow?.status).toBe('refunded');
        expect(target?.status).toBe('refunded');
        expect(advertiserWallet?.balance?.toString()).toBe('150');
        expect(refundLedger?.amount.toString()).toBe('30');
    });
});