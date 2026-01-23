import { PrismaService } from '@/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';

import { TelegramService } from '@/modules/telegram/telegram.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { assertPostJobTransition } from '@/modules/lifecycle/lifecycle';
import { postDlq, redisConnection } from '../queues';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { KillSwitchKey, PostJobStatus } from '@prisma/client';
import { RedisService } from '@/modules/redis/redis.service';
import { runWithCorrelationId } from '@/common/logging/correlation-id.store';

export function startPostWorker(
    prisma: PrismaService,
    escrowService: EscrowService,
    telegramService: TelegramService,
    killSwitchService: KillSwitchService,
    redisService: RedisService,
) {
    const logger = new Logger('PostWorker');
    const redisClient = redisService.getClient();
    const heartbeatKey = 'worker:heartbeat';
    const heartbeatIntervalMs = 10000;
    const heartbeatTtlSeconds = 40;

    const updateHeartbeat = async () => {
        try {
            await redisClient.set(
                heartbeatKey,
                new Date().toISOString(),
                'EX',
                heartbeatTtlSeconds,
            );
        } catch (err) {
            logger.error(
                '[HEARTBEAT] Failed to update worker heartbeat',
                err instanceof Error ? err.stack : String(err),
            );
        }
    };

    void updateHeartbeat();
    const heartbeatTimer = setInterval(() => {
        void updateHeartbeat();
    }, heartbeatIntervalMs);
    const worker = new Worker(
        'post-queue',
        async (job) => runWithCorrelationId(job.data?.postJobId, async () => {
            const { postJobId } = job.data;
            const now = new Date();
            const maxAttempts = job.opts.attempts
                ?? Number(process.env.POST_JOB_MAX_ATTEMPTS ?? 3);

            const reservation = await prisma.postJob.updateMany({
                where: { id: postJobId, status: PostJobStatus.queued },
                data: {
                    status: PostJobStatus.sending,
                    sendingAt: now,
                    lastAttemptAt: now,
                    attempts: { increment: 1 },
                },
            });

            if (reservation.count === 0) {
                return { skipped: true };
            }

            const postJob = await prisma.postJob.findUnique({
                where: { id: postJobId },
                include: {
                    campaignTarget: true,
                },
            });

            if (!postJob) {
                throw new Error('PostJob not found');
            }

            try {
                const workerEnabled = await killSwitchService.isEnabled(
                    KillSwitchKey.worker_post,
                );
                if (!workerEnabled) {
                    const delayMs = 5 * 60 * 1000;
                    logger.warn(
                        `[KILL_SWITCH] worker_post blocked, delaying job ${postJob.id}`,
                    );
                    await job.moveToDelayed(Date.now() + delayMs);
                    return { delayed: true, reason: 'worker_post' };
                }

                const telegramEnabled = await killSwitchService.isEnabled(
                    KillSwitchKey.telegram_posting,
                );
                if (!telegramEnabled) {
                    const delayMs = 5 * 60 * 1000;
                    logger.warn(
                        `[KILL_SWITCH] telegram_posting blocked, delaying job ${postJob.id}`,
                    );
                    await job.moveToDelayed(Date.now() + delayMs);
                    return { delayed: true, reason: 'telegram_posting' };
                }

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
                        to: PostJobStatus.success,
                        actor: 'worker',
                        correlationId: postJob.id,
                    });

                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: {
                            status: PostJobStatus.success,
                            sendingAt: null,
                            telegramMessageId: telegramResult.telegramMessageId
                                ? BigInt(telegramResult.telegramMessageId)
                                : null,
                        },
                    });

                    await escrowService.release(postJob.campaignTargetId, {
                        transaction: tx,
                        actor: 'worker',
                        correlationId: postJob.id,
                    });
                });

                return {
                    ok: true,
                    telegramMessageId: telegramResult.telegramMessageId,
                };
            } catch (err) {
                const attemptsMade = job.attemptsMade + 1;
                const shouldRetry = attemptsMade < maxAttempts;

                await prisma.$transaction(async (tx) => {
                    assertPostJobTransition({
                        postJobId: postJob.id,
                        from: postJob.status,
                        to: shouldRetry ? PostJobStatus.queued : PostJobStatus.failed,
                        actor: 'worker',
                        correlationId: postJob.id,
                    });

                    await tx.postJob.update({
                        where: { id: postJob.id },
                        data: {
                            status: shouldRetry
                                ? PostJobStatus.queued
                                : PostJobStatus.failed,
                            lastError:
                                err instanceof Error ? err.message : String(err),
                            sendingAt: null,
                        },
                    });

                    if (!shouldRetry) {
                        await escrowService.refund(postJob.campaignTargetId, {
                            reason: 'post_failed',
                            transaction: tx,
                            actor: 'worker',
                            correlationId: postJob.id,
                        });
                    }
                });

                throw err;
            }
        }),
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
        clearInterval(heartbeatTimer);
        await worker.close();
        await postDlq.close();
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    return worker;
}