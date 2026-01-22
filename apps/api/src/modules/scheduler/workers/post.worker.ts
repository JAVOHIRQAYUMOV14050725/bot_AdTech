import { PrismaService } from '@/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';

import { TelegramService } from '@/modules/telegram/telegram.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { assertPostJobTransition } from '@/modules/lifecycle/lifecycle';
import { postDlq, redisConnection } from '../queues';

export function startPostWorker(
    prisma: PrismaService,
    escrowService: EscrowService,
    telegramService: TelegramService,
) {
    const logger = new Logger('PostWorker');
    const worker = new Worker(
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
                    assertPostJobTransition({
                        postJobId: postJob.id,
                        from: postJob.status,
                        to: 'success',
                        actor: 'worker',
                    });

                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: { status: 'success' },
                    });

                    await escrowService.release(postJob.campaignTargetId, {
                        transaction: tx,
                        actor: 'worker',
                    });
                });

                return {
                    ok: true,
                    telegramMessageId: telegramResult.telegramMessageId,
                };
            } catch (err) {
                // ❌ FAILED FLOW (ATOMIC)
                await prisma.$transaction(async (tx) => {
                    assertPostJobTransition({
                        postJobId: postJob.id,
                        from: postJob.status,
                        to: 'failed',
                        actor: 'worker',
                    });

                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: {
                            status: 'failed',
                            attempts: { increment: 1 },
                            lastError:
                                err instanceof Error ? err.message : String(err),
                        },
                    });

                    await escrowService.refund(postJob.campaignTargetId, {
                        reason: 'post_failed',
                        transaction: tx,
                        actor: 'worker',
                    });
                });

                throw err;
            }
        },
        {
            connection: redisConnection,
            concurrency: 5,
        },
    );

    worker.on('failed', async (job, err) => {
        if (!job) {
            return;
        }

        const maxAttempts = job.opts.attempts ?? 1;
        if (job.attemptsMade >= maxAttempts) {
            try {
                await postDlq.add(
                    'post-failed',
                    {
                        postJobId: job.data.postJobId,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    {
                        jobId: `dlq:${job.id}`,
                        removeOnComplete: true,
                        removeOnFail: false,
                    },
                );
                logger.error(
                    `Moved job ${job.id} to DLQ after ${job.attemptsMade} attempts`,
                );
            } catch (dlqError) {
                logger.error(
                    `Failed to enqueue DLQ for job ${job.id}`,
                    dlqError instanceof Error ? dlqError.stack : String(dlqError),
                );
            }
        }
    });

    worker.on('error', (err) => {
        logger.error(
            'Worker error',
            err instanceof Error ? err.stack : String(err),
        );
    });

    const shutdown = async () => {
        logger.log('Shutting down post worker');
        await worker.close();
        await postDlq.close();
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    return worker;
}
