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

    describe('Payments integration (wallet / ledger / escrow)', () => {
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

                    // 🔧 REQUIRED INFRA
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

        // ─────────────────────────────────────────────
        // 💰 DEPOSIT
        // ─────────────────────────────────────────────
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

            await paymentsService.deposit(
                user.id,
                new Prisma.Decimal(50),
                'test-deposit',
            );

            const dbWallet = await prisma.wallet.findUnique({
                where: { id: wallet.id },
                select: { balance: true },
            });

            const ledgerSum = await prisma.ledgerEntry.aggregate({
                where: { walletId: wallet.id },
                _sum: { amount: true },
            });

            expect(dbWallet?.balance?.toString()).toBe('50');
            expect(
                new Prisma.Decimal(ledgerSum._sum.amount ?? 0).toString(),
            ).toBe('50');
        });

        // ─────────────────────────────────────────────
        // 🔒 ESCROW HOLD
        // ─────────────────────────────────────────────
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

        // ─────────────────────────────────────────────
        // ✅ RELEASE
        // ─────────────────────────────────────────────
        it('releases escrow, credits publisher, and marks target posted', async () => {
            await seedKillSwitches(prisma, {
                new_escrows: true,
                payouts: true,
            });

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

            await escrowService.release(scenario.target.id, {
                actor: 'worker',
            });

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

        // ─────────────────────────────────────────────
        // 🔄 REFUND
        // ─────────────────────────────────────────────
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

            await escrowService.refund(scenario.target.id, {
                actor: 'worker',
            });

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
