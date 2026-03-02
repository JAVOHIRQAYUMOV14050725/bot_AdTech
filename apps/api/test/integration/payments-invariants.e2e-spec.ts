import { Test } from '@nestjs/testing';
import { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';
import { CreateAdDealUseCase } from '@/modules/application/addeal/create-addeal.usecase';
import { FundAdDealUseCase } from '@/modules/application/addeal/fund-addeal.usecase';
import { LockEscrowUseCase } from '@/modules/application/addeal/lock-escrow.usecase';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { AdvertiserConfirmUseCase } from '@/modules/application/addeal/advertiser-confirm.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { DealState, LedgerReason, LedgerType, TransitionActor } from '@/modules/domain/contracts';
import { createUserWithWallet, resetDatabase, seedKillSwitches } from '../utils/test-helpers';

describe('Payments invariants', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let createAdDeal: CreateAdDealUseCase;
    let fundAdDeal: FundAdDealUseCase;
    let lockEscrow: LockEscrowUseCase;
    let acceptDeal: AcceptDealUseCase;
    let advertiserConfirm: AdvertiserConfirmUseCase;
    let submitProof: SubmitProofUseCase;
    let settleAdDeal: SettleAdDealUseCase;
    let dbAvailable = true;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                KillSwitchService,
                PaymentsService,
                CreateAdDealUseCase,
                FundAdDealUseCase,
                LockEscrowUseCase,
                AcceptDealUseCase,
                AdvertiserConfirmUseCase,
                SubmitProofUseCase,
                SettleAdDealUseCase,
                {
                    provide: ClickPaymentService,
                    useValue: {
                        createInvoice: jest.fn(),
                        getInvoiceStatus: jest.fn(),
                        verifyWebhookSignature: jest.fn().mockReturnValue(true),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(() => false),
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
        createAdDeal = moduleRef.get(CreateAdDealUseCase);
        fundAdDeal = moduleRef.get(FundAdDealUseCase);
        lockEscrow = moduleRef.get(LockEscrowUseCase);
        acceptDeal = moduleRef.get(AcceptDealUseCase);
        advertiserConfirm = moduleRef.get(AdvertiserConfirmUseCase);
        submitProof = moduleRef.get(SubmitProofUseCase);
        settleAdDeal = moduleRef.get(SettleAdDealUseCase);

        try {
            await prisma.$connect();
        } catch {
            dbAvailable = false;
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        await prisma.disputeAuditLog.deleteMany();
        await prisma.dispute.deleteMany();
        await prisma.adDealEscrow.deleteMany();
        await prisma.adDealFundingEvent.deleteMany();
        await prisma.adDeal.deleteMany();
        await resetDatabase(prisma);
        await seedKillSwitches(prisma);
    });

    afterAll(async () => {
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    it('prevents overdraft under 20 parallel debits', async () => {
        if (!dbAvailable) {
            return;
        }

        const advertiser = await createUserWithWallet({
            prisma,
            role: UserRole.advertiser,
            balance: new Prisma.Decimal(100),
        });

        const attempts = await Promise.allSettled(
            Array.from({ length: 20 }).map((_, idx) =>
                prisma.$transaction((tx) =>
                    paymentsService.recordWalletMovement({
                        tx,
                        walletId: advertiser.wallet.id,
                        amount: new Prisma.Decimal(10),
                        type: LedgerType.debit,
                        reason: LedgerReason.withdrawal,
                        idempotencyKey: `parallel:debit:${idx}`,
                        correlationId: 'parallel:debit:test',
                    }),
                ),
            ),
        );

        const succeeded = attempts.filter((entry) => entry.status === 'fulfilled');
        const failed = attempts.filter((entry) => entry.status === 'rejected');

        expect(succeeded).toHaveLength(10);
        expect(failed).toHaveLength(10);

        const wallet = await prisma.wallet.findUniqueOrThrow({
            where: { id: advertiser.wallet.id },
        });
        expect(wallet.balance.toFixed(2)).toBe('0.00');
    });

    it('conserves balances and uses escrow pool through addeal lifecycle', async () => {
        if (!dbAvailable) {
            return;
        }

        const advertiser = await createUserWithWallet({
            prisma,
            role: UserRole.advertiser,
            balance: new Prisma.Decimal(500),
        });
        const publisher = await createUserWithWallet({
            prisma,
            role: UserRole.publisher,
            balance: new Prisma.Decimal(0),
        });
        const platform = await createUserWithWallet({
            prisma,
            role: UserRole.super_admin,
            balance: new Prisma.Decimal(0),
        });

        const sumTrackedBalances = async () => {
            const wallets = await prisma.wallet.findMany({
                where: {
                    OR: [
                        { id: advertiser.wallet.id },
                        { id: publisher.wallet.id },
                        { id: platform.wallet.id },
                        { systemKey: 'ESCROW_POOL' },
                    ],
                },
                select: { balance: true },
            });
            return wallets.reduce(
                (acc, wallet) => acc.add(wallet.balance),
                new Prisma.Decimal(0),
            ).toFixed(2);
        };

        const created = await createAdDeal.execute({
            advertiserId: advertiser.user.id,
            publisherId: publisher.user.id,
            amount: '100.00',
            commissionPercentage: '10',
            idempotencyKey: `flow:${advertiser.user.id}:${publisher.user.id}:create`,
            correlationId: 'flow:addeal:create',
        });
        expect(created.status).toBe(DealState.created);

        const totalBefore = await sumTrackedBalances();

        await fundAdDeal.execute({
            adDealId: created.id,
            provider: 'wallet_balance',
            providerReference: `flow:${created.id}:fund`,
            amount: '100.00',
            verified: true,
            actor: TransitionActor.advertiser,
        });

        const totalAfterFunded = await sumTrackedBalances();
        expect(totalAfterFunded).toBe(totalBefore);

        await lockEscrow.execute({
            adDealId: created.id,
            actor: TransitionActor.advertiser,
        });

        const totalAfterLocked = await sumTrackedBalances();
        expect(totalAfterLocked).toBe(totalBefore);

        const escrowPool = await prisma.wallet.findUniqueOrThrow({
            where: { systemKey: 'ESCROW_POOL' },
        });
        expect(escrowPool.balance.toFixed(2)).toBe('100.00');

        await acceptDeal.execute({ adDealId: created.id, actor: TransitionActor.publisher });
        await advertiserConfirm.execute({ adDealId: created.id, actor: TransitionActor.advertiser });
        await submitProof.execute({
            adDealId: created.id,
            proofPayload: { text: 'proof' },
            actor: TransitionActor.publisher,
        });

        await settleAdDeal.execute({
            adDealId: created.id,
            actor: TransitionActor.system,
        });

        const totalAfterSettled = await sumTrackedBalances();
        expect(totalAfterSettled).toBe(totalBefore);

        const [advAfter, pubAfter, platformAfter, escrowAfter] = await Promise.all([
            prisma.wallet.findUniqueOrThrow({ where: { id: advertiser.wallet.id } }),
            prisma.wallet.findUniqueOrThrow({ where: { id: publisher.wallet.id } }),
            prisma.wallet.findUniqueOrThrow({ where: { id: platform.wallet.id } }),
            prisma.wallet.findUniqueOrThrow({ where: { systemKey: 'ESCROW_POOL' } }),
        ]);

        expect(pubAfter.id).toBe(publisher.wallet.id);
        expect(platformAfter.id).toBe(platform.wallet.id);
        expect(advAfter.balance.toFixed(2)).toBe('400.00');
        expect(pubAfter.balance.toFixed(2)).toBe('90.00');
        expect(platformAfter.balance.toFixed(2)).toBe('10.00');
        expect(escrowAfter.balance.toFixed(2)).toBe('0.00');

        const totalAfter = advAfter.balance
            .add(pubAfter.balance)
            .add(platformAfter.balance)
            .add(escrowAfter.balance)
            .toFixed(2);
        expect(totalAfter).toBe(totalBefore);
    });
});