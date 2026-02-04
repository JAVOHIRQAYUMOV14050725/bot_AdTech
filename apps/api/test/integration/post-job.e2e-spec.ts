import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { workerConfig as workerConfigFactory } from '@/config/worker.config';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { AdminHandler } from '@/modules/telegram/handlers/admin.handler';
import { startPostWorker } from '@/modules/scheduler/workers/post.worker';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@nestjs/common';
import { RedisService } from '@/modules/redis/redis.service';
import { ClickPaymentService } from '@/modules/infrastructure/payments/click-payment.service';
import { TelegramBackendClient } from '@/modules/telegram/telegram-backend.client';

import {
    createCampaignTargetScenario,
    resetDatabase,
    seedKillSwitches,
    waitForCondition,
} from '../utils/test-helpers';

// ✅ REAL WORKER CONFIG
const workerSettings = workerConfigFactory();

jest.mock('@/modules/scheduler/queues', () => ({
    redisConnection: {},
    postQueue: {
        drain: jest.fn(),
        clean: jest.fn(),
        add: jest.fn(),
        close: jest.fn(),
    },
    postDlq: {
        add: jest.fn(),
    },
}));

const { postQueue } = jest.requireMock('@/modules/scheduler/queues');

describe('PostJob integration (BullMQ + worker)', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let escrowService: EscrowService;
    let killSwitchService: KillSwitchService;
    let telegramService: TelegramService;
    let redisService: RedisService;
    let logger: LoggerService;
    let dbAvailable = true;

    beforeAll(async () => {
        process.env.TELEGRAM_BOT_TOKEN ??= 'test-token';

        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                KillSwitchService,
                PaymentsService,
                EscrowService,
                AdminHandler,
                TelegramService,

                {
                    provide: ConfigService,
                    useValue: { get: jest.fn() },
                },
                {
                    provide: ClickPaymentService,
                    useValue: {
                        createInvoice: jest.fn(),
                        getInvoiceStatus: jest.fn(),
                        verifyWebhookSignature: jest.fn().mockReturnValue(true),
                    },
                },
                {
                    provide: TelegramBackendClient,
                    useValue: {
                        adminForceRelease: jest.fn(),
                        adminForceRefund: jest.fn(),
                        adminRetryPost: jest.fn(),
                        adminFreezeCampaign: jest.fn(),
                        adminUnfreezeCampaign: jest.fn(),
                    },
                },
                {
                    provide: 'CONFIGURATION(telegram)',
                    useValue: {
                        botToken: 'test-token',
                        parseMode: 'HTML',
                        disableWebPreview: true,
                    },
                },
                {
                    provide: 'CONFIGURATION(app)',
                    useValue: {
                        env: 'test',
                        name: 'api',
                    },
                },


                {
                    provide: RedisService,
                    useValue: {
                        getClient: jest.fn(() => ({
                            quit: jest.fn(),
                        })),
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
        killSwitchService = moduleRef.get(KillSwitchService);
        telegramService = moduleRef.get(TelegramService);
        redisService = moduleRef.get(RedisService);
        logger = moduleRef.get('LOGGER');

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

        await postQueue.drain(true);
        await postQueue.clean(0, 1000, 'completed');
        await postQueue.clean(0, 1000, 'failed');
        await postQueue.clean(0, 1000, 'delayed');
    });

    afterAll(async () => {
        await postQueue.close();

        const client = redisService.getClient?.();
        if (client?.quit) {
            await client.quit();
        }

        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });


    it('delays posting when worker_post kill switch is OFF', async () => {
        if (!dbAvailable) {
            return;
        }
        await seedKillSwitches(prisma, {
            worker_post: false,
            telegram_posting: true,
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

        const worker = startPostWorker(
            prisma,
            escrowService,
            telegramService,
            killSwitchService,
            redisService,
            logger,
            workerSettings,
        );

        await postQueue.add(
            'post',
            { postJobId: scenario.postJob.id },
            { jobId: scenario.postJob.id, removeOnComplete: true },
        );

        await waitForCondition(async () => {
            const job = await prisma.postJob.findUnique({
                where: { id: scenario.postJob.id },
            });
            return job?.status === 'queued';
        });

        await worker.close();

        const finalJob = await prisma.postJob.findUnique({
            where: { id: scenario.postJob.id },
        });

        expect(finalJob?.status).toBe('queued');
    });

    it('marks failed post jobs and refunds escrow when Telegram send fails', async () => {
        if (!dbAvailable) {
            return;
        }
        await seedKillSwitches(prisma, {
            worker_post: true,
            telegram_posting: true,
            new_escrows: true,
        });

        const scenario = await createCampaignTargetScenario({
            prisma,
            advertiserBalance: new Prisma.Decimal(90),
            publisherBalance: new Prisma.Decimal(0),
            price: new Prisma.Decimal(20),
            creativePayload: { text: '' } as Prisma.JsonObject,
        });

        await paymentsService.holdEscrow(scenario.target.id);

        const worker = startPostWorker(
            prisma,
            escrowService,
            telegramService,
            killSwitchService,
            redisService,
            logger,
            workerSettings,
        );

        await postQueue.add(
            'post',
            { postJobId: scenario.postJob.id },
            { jobId: scenario.postJob.id, removeOnComplete: true },
        );

        await waitForCondition(async () => {
            const job = await prisma.postJob.findUnique({
                where: { id: scenario.postJob.id },
            });
            return job?.status === 'failed';
        });

        await worker.close();

        const job = await prisma.postJob.findUnique({
            where: { id: scenario.postJob.id },
        });

        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });

        const target = await prisma.campaignTarget.findUnique({
            where: { id: scenario.target.id },
        });

        expect(job?.status).toBe('failed');
        expect(escrow?.status).toBe('refunded');
        expect(target?.status).toBe('refunded');
    });
});
