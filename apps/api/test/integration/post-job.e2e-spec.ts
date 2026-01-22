import { Prisma } from '@prisma/client';
import { postQueue } from '@/modules/scheduler/queues';
import { startPostWorker } from '@/modules/scheduler/workers/post.worker';
import { EscrowService } from '@/modules/payments/escrow.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { AdminHandler } from '@/modules/telegram/handlers/admin.handler';
import { TelegramService } from '@/modules/telegram/telegram.service';
import {
    createCampaignTargetScenario,
    resetDatabase,
    seedKillSwitches,
    waitForCondition,
} from '../utils/test-helpers';
import { PrismaService } from '@/prisma/prisma.service';

describe('PostJob integration (BullMQ + worker)', () => {
    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let escrowService: EscrowService;
    let killSwitchService: KillSwitchService;
    let telegramService: TelegramService;

    beforeAll(async () => {
        if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
            throw new Error('REDIS_HOST/REDIS_PORT must be set for BullMQ tests');
        }

        process.env.TELEGRAM_BOT_TOKEN ??= 'test-token';

        prisma = new PrismaService();
        await prisma.$connect();
        killSwitchService = new KillSwitchService(prisma);
        paymentsService = new PaymentsService(prisma, killSwitchService);
        escrowService = new EscrowService(prisma, paymentsService, killSwitchService);
        const adminHandler = new AdminHandler(prisma, escrowService);
        telegramService = new TelegramService(prisma, adminHandler);
    });

    beforeEach(async () => {
        await resetDatabase(prisma);
        await postQueue.drain(true);
        await postQueue.clean(0, 1000, 'completed');
        await postQueue.clean(0, 1000, 'failed');
        await postQueue.clean(0, 1000, 'delayed');
    });

    afterAll(async () => {
        await postQueue.close();
        await prisma.$disconnect();
    });

    it('delays posting when worker_post kill switch is OFF', async () => {
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
        );

        await postQueue.add(
            'post',
            { postJobId: scenario.postJob.id },
            { jobId: scenario.postJob.id, removeOnComplete: true },
        );

        await waitForCondition(async () => {
            const dbJob = await prisma.postJob.findUnique({
                where: { id: scenario.postJob.id },
            });
            return dbJob?.status === 'queued';
        });

        await worker.close();

        const dbJob = await prisma.postJob.findUnique({
            where: { id: scenario.postJob.id },
        });

        expect(dbJob?.status).toBe('queued');
    });

    it('marks failed post jobs and refunds escrow when Telegram send fails', async () => {
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
        );

        await postQueue.add(
            'post',
            { postJobId: scenario.postJob.id },
            { jobId: scenario.postJob.id, removeOnComplete: true },
        );

        await waitForCondition(async () => {
            const dbJob = await prisma.postJob.findUnique({
                where: { id: scenario.postJob.id },
            });
            return dbJob?.status === 'failed';
        });

        await worker.close();

        const dbJob = await prisma.postJob.findUnique({
            where: { id: scenario.postJob.id },
        });
        const escrow = await prisma.escrow.findUnique({
            where: { campaignTargetId: scenario.target.id },
        });
        const target = await prisma.campaignTarget.findUnique({
            where: { id: scenario.target.id },
        });

        expect(dbJob?.status).toBe('failed');
        expect(escrow?.status).toBe('refunded');
        expect(target?.status).toBe('refunded');
    });
});
