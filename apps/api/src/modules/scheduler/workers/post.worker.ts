import { PrismaService } from '@/prisma/prisma.service';
import { LoggerService } from '@nestjs/common'; // ✅
import { Worker } from 'bullmq';
import { ConfigType } from '@nestjs/config';
import { workerConfig } from '@/config/worker.config';

import { TelegramService } from '@/modules/telegram/telegram.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { assertPostJobTransition } from '@/modules/lifecycle/lifecycle';
import { postDlq, redisConnection } from '../queues';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { KillSwitchKey, PostJobStatus } from '@prisma/client';
import { RedisService } from '@/modules/redis/redis.service';
import { runWithWorkerContext } from '@/common/context/request-context';

export function startPostWorker(
    prisma: PrismaService,
    escrowService: EscrowService,
    telegramService: TelegramService,
    killSwitchService: KillSwitchService,
    redisService: RedisService,
    logger: LoggerService, // ✅ endi tashqaridan keladi
    config: ConfigType<typeof workerConfig>,
) {
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
                {
                    event: 'worker_heartbeat_failed',
                    alert: true,
                    entityType: 'worker',
                    entityId: 'post_worker',
                    data: {
                        heartbeatKey,
                        error: err instanceof Error ? err.message : String(err),
                    },
                },
                err instanceof Error ? err.stack : undefined,
                'PostWorker',
            );
        }
    };

    void updateHeartbeat();
    const heartbeatTimer = setInterval(() => void updateHeartbeat(), heartbeatIntervalMs);

    const worker = new Worker(
        'post-queue',
        async (job) =>
            runWithWorkerContext('post-queue', job.id, async () => {
                const { postJobId } = job.data;
                const now = new Date();
                const maxAttempts = job.opts.attempts ?? config.postJobMaxAttempts;

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
                    logger.warn(
                        {
                            event: 'post_job_reservation_failed',
                            entityType: 'post_job',
                        },
                        'PostWorker',
                    );
                }

                const postJob = await prisma.postJob.findUnique({
                    where: { id: postJobId },
                    include: { campaignTarget: true },
                });

                if (!postJob) {
                    throw new Error('PostJob not found');
                }

                try {
                    const workerEnabled = await killSwitchService.isEnabled(KillSwitchKey.worker_post);
                    if (!workerEnabled) {
                        const delayMs = 5 * 60 * 1000;
                        logger.warn(
                            {
                                event: 'kill_switch_blocked',
                                entityType: 'post_job',
                                entityId: postJob.id,
                                data: { key: 'worker_post', delayMs },
                            },
                            'PostWorker',
                        );
                        await job.moveToDelayed(Date.now() + delayMs);
                        return { delayed: true, reason: 'worker_post' };
                    }

                    const telegramEnabled = await killSwitchService.isEnabled(KillSwitchKey.telegram_posting);
                    if (!telegramEnabled) {
                        const delayMs = 5 * 60 * 1000;
                        logger.warn(
                            {
                                event: 'kill_switch_blocked',
                                entityType: 'post_job',
                                entityId: postJob.id,
                                data: { key: 'telegram_posting', delayMs },
                            },
                            'PostWorker',
                        );
                        await job.moveToDelayed(Date.now() + delayMs);
                        return { delayed: true, reason: 'telegram_posting' };
                    }

                    const telegramResult = await telegramService.sendCampaignPost(postJob.id);
                    if (!telegramResult.ok) {
                        const failureError = new Error(
                            `Telegram send failed: ${telegramResult.reason}`,
                        );
                        (failureError as { telegramFailure?: typeof telegramResult }).telegramFailure = telegramResult;
                        throw failureError;
                    }

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

                    logger.log(
                        {
                            event: 'post_job_sent_success',
                            entityType: 'post_job',
                            entityId: postJob.id,
                            data: { telegramMessageId: telegramResult.telegramMessageId ?? null },
                        },
                        'PostWorker',
                    );

                    return { ok: true, telegramMessageId: telegramResult.telegramMessageId };
                } catch (err) {
                    const failure = (err as { telegramFailure?: { ok: false; permanent: boolean; reason: string; retryAfterSeconds?: number | null } })
                        .telegramFailure;
                    const isPermanent = failure?.permanent ?? false;
                    const attemptsMade = job.attemptsMade + 1;
                    const shouldRetry = !isPermanent && attemptsMade < maxAttempts;

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
                                status: shouldRetry ? PostJobStatus.queued : PostJobStatus.failed,
                                lastError: err instanceof Error ? err.message : String(err),
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

                    if (isPermanent) {
                        await job.discard();
                    }

                    logger.error(
                        {
                            event: 'post_job_failed',
                            alert: !shouldRetry,
                            entityType: 'post_job',
                            entityId: postJob.id,
                            data: {
                                attemptsMade,
                                maxAttempts,
                                shouldRetry,
                                permanent: isPermanent,
                                telegramReason: failure?.reason ?? null,
                                retryAfterSeconds: failure?.retryAfterSeconds ?? null,
                                error: err instanceof Error ? err.message : String(err),
                            },
                        },
                        err instanceof Error ? err.stack : undefined,
                        'PostWorker',
                    );

                    throw err;
                }
            }),
        { connection: redisConnection, concurrency: 5 },
    );

    worker.on('failed', async (job, err) => {
        if (!job) return;

        const maxAttempts = job.opts.attempts ?? 1;
        if (job.attemptsMade >= maxAttempts) {
            try {
                await postDlq.add(
                    'post-failed',
                    {
                        postJobId: job.data.postJobId,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    { jobId: `dlq:${job.id}`, removeOnComplete: true, removeOnFail: false },
                );

                logger.warn(
                    {
                        event: 'post_job_moved_to_dlq',
                        alert: true,
                        entityType: 'post_job',
                        entityId: String(job.data.postJobId),
                        data: { jobId: job.id, attemptsMade: job.attemptsMade },
                    },
                    'PostWorker',
                );
            } catch (dlqError) {
                logger.error(
                    {
                        event: 'dlq_enqueue_failed',
                        alert: true,
                        entityType: 'post_job',
                        entityId: String(job.data.postJobId),
                        data: {
                            jobId: job.id,
                            error: dlqError instanceof Error ? dlqError.message : String(dlqError),
                        },
                    },
                    dlqError instanceof Error ? dlqError.stack : undefined,
                    'PostWorker',
                );
            }
        }
    });

    worker.on('error', (err) => {
        logger.error(
            {
                event: 'worker_runtime_error',
                alert: true,
                entityType: 'worker',
                entityId: 'post_worker',
                data: { error: err instanceof Error ? err.message : String(err) },
            },
            err instanceof Error ? err.stack : undefined,
            'PostWorker',
        );
    });

    const shutdown = async () => {
        logger.log(
            { event: 'worker_shutdown', entityType: 'worker', entityId: 'post_worker' },
            'PostWorker',
        );
        clearInterval(heartbeatTimer);
        await worker.close();
        await postDlq.close();
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    return worker;
}