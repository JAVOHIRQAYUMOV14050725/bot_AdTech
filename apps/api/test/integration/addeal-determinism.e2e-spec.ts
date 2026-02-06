import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';
import { CreateAdDealUseCase } from '@/modules/application/addeal/create-addeal.usecase';
import { FundAdDealUseCase } from '@/modules/application/addeal/fund-addeal.usecase';
import { LockEscrowUseCase } from '@/modules/application/addeal/lock-escrow.usecase';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { AdvertiserConfirmUseCase } from '@/modules/application/addeal/advertiser-confirm.usecase';
import { PublisherDeclineUseCase } from '@/modules/application/addeal/publisher-decline.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { DealState, LedgerReason, TransitionActor } from '@/modules/domain/contracts';
import { createUserWithWallet, resetDatabase, seedKillSwitches } from '../utils/test-helpers';

describe('AdDeal determinism gate (full handshake)', () => {
    let prisma: PrismaService;
    let createAdDeal: CreateAdDealUseCase;
    let fundAdDeal: FundAdDealUseCase;
    let lockEscrow: LockEscrowUseCase;
    let acceptDeal: AcceptDealUseCase;
    let advertiserConfirm: AdvertiserConfirmUseCase;
    let declineDeal: PublisherDeclineUseCase;
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
                PublisherDeclineUseCase,
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
        createAdDeal = moduleRef.get(CreateAdDealUseCase);
        fundAdDeal = moduleRef.get(FundAdDealUseCase);
        lockEscrow = moduleRef.get(LockEscrowUseCase);
        acceptDeal = moduleRef.get(AcceptDealUseCase);
        advertiserConfirm = moduleRef.get(AdvertiserConfirmUseCase);
        declineDeal = moduleRef.get(PublisherDeclineUseCase);
        submitProof = moduleRef.get(SubmitProofUseCase);
        settleAdDeal = moduleRef.get(SettleAdDealUseCase);

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
        await seedKillSwitches(prisma);
    });

    afterAll(async () => {
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    it('executes deterministic advertiser→publisher→confirm→proof→settle flow with idempotency', async () => {
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
        await createUserWithWallet({
            prisma,
            role: UserRole.super_admin,
            balance: new Prisma.Decimal(0),
        });

        const created = await createAdDeal.execute({
            advertiserId: advertiser.user.id,
            publisherId: publisher.user.id,
            amount: '100.00',
            commissionPercentage: '10',
        });
        expect(created.status).toBe(DealState.created);

        await fundAdDeal.execute({
            adDealId: created.id,
            provider: 'wallet_balance',
            providerReference: `test:${created.id}:fund`,
            amount: '100.00',
            verified: true,
            actor: TransitionActor.advertiser,
        });

        const funded = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(funded?.status).toBe(DealState.funded);

        await lockEscrow.execute({
            adDealId: created.id,
            actor: TransitionActor.advertiser,
        });

        const requested = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(requested?.status).toBe(DealState.publisher_requested);

        await acceptDeal.execute({
            adDealId: created.id,
            actor: TransitionActor.publisher,
        });

        const accepted = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(accepted?.status).toBe(DealState.accepted);

        await advertiserConfirm.execute({
            adDealId: created.id,
            actor: TransitionActor.advertiser,
        });

        const confirmed = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(confirmed?.status).toBe(DealState.advertiser_confirmed);

        await submitProof.execute({
            adDealId: created.id,
            proofPayload: { text: 'proof' },
            actor: TransitionActor.publisher,
        });

        const proofed = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(proofed?.status).toBe(DealState.proof_submitted);

        const commissionBefore = await prisma.ledgerEntry.count({
            where: { reason: LedgerReason.commission, referenceId: created.id },
        });
        expect(commissionBefore).toBe(0);

        await settleAdDeal.execute({
            adDealId: created.id,
            actor: TransitionActor.system,
        });

        const settled = await prisma.adDeal.findUnique({ where: { id: created.id } });
        expect(settled?.status).toBe(DealState.settled);

        const ledgerReasons = await prisma.ledgerEntry.findMany({
            where: { referenceId: created.id },
            select: { reason: true },
        });
        const reasons = ledgerReasons.map((entry) => entry.reason);
        expect(reasons).toEqual(
            expect.arrayContaining([
                LedgerReason.escrow_hold,
                LedgerReason.payout,
                LedgerReason.commission,
            ]),
        );

        const commissionAfter = await prisma.ledgerEntry.count({
            where: { reason: LedgerReason.commission, referenceId: created.id },
        });
        expect(commissionAfter).toBe(1);

        await settleAdDeal.execute({
            adDealId: created.id,
            actor: TransitionActor.system,
        });

        const commissionAfterReplay = await prisma.ledgerEntry.count({
            where: { reason: LedgerReason.commission, referenceId: created.id },
        });
        expect(commissionAfterReplay).toBe(1);

        await expect(
            declineDeal.execute({
                adDealId: created.id,
                actor: TransitionActor.publisher,
            }),
        ).rejects.toThrow();
    });
});
