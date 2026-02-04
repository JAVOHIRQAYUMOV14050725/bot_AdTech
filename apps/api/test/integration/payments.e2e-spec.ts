import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';
import { TransitionActor } from '@/modules/domain/contracts';

import {
    createCampaignTargetScenario,
    resetDatabase,
    seedKillSwitches,
} from '../utils/test-helpers';

describe('Payments integration (wallet / ledger / escrow)', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let escrowService: EscrowService;
    let clickPaymentService: ClickPaymentService;
    let dbAvailable = true;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                KillSwitchService,
                PaymentsService,
                EscrowService,
                {
                    provide: ClickPaymentService,
                    useValue: {
                        createInvoice: jest.fn().mockResolvedValue({
                            invoice_id: 'invoice-1',
                            payment_url: 'https://click.uz/pay/1',
                        }),
                        getInvoiceStatus: jest.fn().mockResolvedValue({
                            status: 'paid',
                            click_trans_id: 'click-1',
                        }),
                        verifyWebhookSignature: jest.fn().mockReturnValue(true),
                    },
                },

                // 🔧 REQUIRED INFRA
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) => {
                            if (key === 'ENABLE_CLICK_PAYMENTS') return true;
                            return false;
                        }),
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
        clickPaymentService = moduleRef.get(ClickPaymentService);

        try {
            await prisma.$connect();
        } catch (err) {
            dbAvailable = false;
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    // ─────────────────────────────────────────────
    // 💰 DEPOSIT
    // ─────────────────────────────────────────────
    it('records deposits and preserves wallet = ledger invariant', async () => {
        if (!dbAvailable) {
            return;
        }
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

        const intent = await paymentsService.createDepositIntent({
            userId: user.id,
            amount: new Prisma.Decimal(50),
            idempotencyKey: 'test-deposit',
        });

        await paymentsService.finalizeDepositIntent({
            payload: {
                merchant_trans_id: intent.id,
                click_trans_id: 'click-1',
                error: 0,
                amount: '50.00',
                sign_time: Math.floor(Date.now() / 1000),
                action: '1',
            },
        });

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

    it('does not double-credit on duplicate webhook', async () => {
        if (!dbAvailable) {
            return;
        }
        const user = await prisma.user.create({
            data: {
                telegramId: BigInt(7002),
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

        const intent = await paymentsService.createDepositIntent({
            userId: user.id,
            amount: new Prisma.Decimal(25),
            idempotencyKey: 'test-deposit-dup',
        });

        const payload = {
            merchant_trans_id: intent.id,
            click_trans_id: 'click-dup',
            error: 0,
            amount: '25.00',
            sign_time: Math.floor(Date.now() / 1000),
            action: '1',
        };

        await paymentsService.finalizeDepositIntent({
            payload,
        });

        await paymentsService.finalizeDepositIntent({
            payload,
        });

        const ledgerEntries = await prisma.ledgerEntry.findMany({
            where: { walletId: wallet.id, reason: 'deposit' },
        });

        expect(ledgerEntries).toHaveLength(1);
    });

    it('is idempotent across duplicate provider transactions', async () => {
        if (!dbAvailable) {
            return;
        }
        const user = await prisma.user.create({
            data: {
                telegramId: BigInt(7004),
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

        const intentA = await paymentsService.createDepositIntent({
            userId: user.id,
            amount: new Prisma.Decimal(30),
            idempotencyKey: 'test-deposit-a',
        });

        const intentB = await paymentsService.createDepositIntent({
            userId: user.id,
            amount: new Prisma.Decimal(30),
            idempotencyKey: 'test-deposit-b',
        });

        const payload = {
            merchant_trans_id: intentA.id,
            click_trans_id: 'click-shared',
            error: 0,
            amount: '30.00',
            sign_time: Math.floor(Date.now() / 1000),
            action: '1',
        };

        await paymentsService.finalizeDepositIntent({ payload });

        const response = await paymentsService.finalizeDepositIntent({
            payload: { ...payload, merchant_trans_id: intentB.id },
        });

        expect(response).toEqual({ ok: true, idempotent: true });

        const ledgerEntries = await prisma.ledgerEntry.findMany({
            where: { walletId: wallet.id, reason: 'deposit' },
        });

        expect(ledgerEntries).toHaveLength(1);
    });

    it('rejects unverified webhook payloads', async () => {
        if (!dbAvailable) {
            return;
        }
        const user = await prisma.user.create({
            data: {
                telegramId: BigInt(7003),
                role: 'advertiser',
                status: 'active',
            },
        });

        await prisma.wallet.create({
            data: {
                userId: user.id,
                balance: new Prisma.Decimal(0),
                currency: 'USD',
            },
        });

        const intent = await paymentsService.createDepositIntent({
            userId: user.id,
            amount: new Prisma.Decimal(10),
            idempotencyKey: 'test-deposit-verify',
        });

        (clickPaymentService.verifyWebhookSignature as jest.Mock).mockReturnValueOnce(false);

        await expect(
            paymentsService.finalizeDepositIntent({
                payload: {
                    merchant_trans_id: intent.id,
                    click_trans_id: 'click-bad',
                    error: 0,
                    amount: '10.00',
                    sign_time: Math.floor(Date.now() / 1000),
                    action: '1',
                },
            }),
        ).rejects.toThrow('Click webhook signature invalid');
    });

    // ─────────────────────────────────────────────
    // 🔒 ESCROW HOLD
    // ─────────────────────────────────────────────
    it('holds escrow and debits advertiser wallet with matching ledger entry', async () => {
        if (!dbAvailable) {
            return;
        }
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
        if (!dbAvailable) {
            return;
        }
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
            actor: TransitionActor.worker,
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
        if (!dbAvailable) {
            return;
        }
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
            actor: TransitionActor.worker,
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