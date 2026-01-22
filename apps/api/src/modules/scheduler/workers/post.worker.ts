import { PrismaService } from '@/prisma/prisma.service';
import { Worker } from 'bullmq';

import { TelegramService } from '@/modules/telegram/telegram.service';
import { EscrowService } from '@/modules/payments/escrow.service';

export function startPostWorker(
    prisma: PrismaService,
    escrowService: EscrowService,
    telegramService: TelegramService,
) {
    return new Worker(
        'post-queue',
        async (job) => {
            const { postJobId } = job.data;

            const postJob = await prisma.postJob.findUnique({
                where: { id: postJobId },
                include: {
                    campaignTarget: true,
                },
            });

            if (!postJob) {
                throw new Error('PostJob not found');
            }

            // 🔐 IDEMPOTENCY GUARD
            if (postJob.status !== 'queued') {
                return { skipped: true };
            }

            try {
                // 🚀 REAL TELEGRAM SEND
                const telegramResult =
                    await telegramService.sendCampaignPost(postJob.id);

                if (!telegramResult.ok) {
                    throw new Error('Telegram send failed');
                }

                // ✅ SUCCESS FLOW (ATOMIC)
                await prisma.$transaction(async (tx) => {
                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: { status: 'success' },
                    });

                    await escrowService.release(postJob.campaignTargetId);
                });

                return {
                    ok: true,
                    telegramMessageId: telegramResult.telegramMessageId,
                };
            } catch (err) {
                // ❌ FAILED FLOW (ATOMIC)
                await prisma.$transaction(async (tx) => {
                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: {
                            status: 'failed',
                            attempts: { increment: 1 },
                            lastError:
                                err instanceof Error ? err.message : String(err),
                        },
                    });

                    await escrowService.refund(postJob.campaignTargetId);
                });

                throw err;
            }
        },
        {
            connection: {
                host: process.env.REDIS_HOST,
                port: Number(process.env.REDIS_PORT),
            },
            concurrency: 5,
        },
    );
}
