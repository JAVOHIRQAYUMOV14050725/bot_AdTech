import { PrismaService } from '@/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ChannelStatus } from '@prisma/client';

import { redisConnection, channelVerifyDlq } from '../queues';
import { VerificationService } from '@/modules/channels/verification.service';
import { TelegramCheckReason } from '@/modules/telegram/telegram.types';
import { RedisService } from '@/modules/redis/redis.service';
import { runWithCorrelationId } from '@/common/logging/correlation-id.store';

export function startChannelVerifyWorker(
    prisma: PrismaService,
    verificationService: VerificationService,
    redisService: RedisService,
) {
    const logger = new Logger('ChannelVerifyWorker');

    /* ============================
       HEARTBEAT (PostWorker bilan bir xil)
       ============================ */
    const redisClient = redisService.getClient();
    const heartbeatKey = 'worker:heartbeat:channel_verify';
    const heartbeatIntervalMs = 10_000;
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
                '[HEARTBEAT] Failed',
                err instanceof Error ? err.stack : String(err),
            );
        }
    };

    void updateHeartbeat();
    const heartbeatTimer = setInterval(updateHeartbeat, heartbeatIntervalMs);

    /* ============================
       WORKER
       ============================ */
    const worker = new Worker(
        'channel-verify-queue',
        async (job) =>
            runWithCorrelationId(job.data?.channelId, async () => {
                const { channelId } = job.data as { channelId: string };
                const now = new Date();

                /* 1️⃣ Channel fetch */
                const channel = await prisma.channel.findUnique({
                    where: { id: channelId },
                    include: { verification: true },
                });

                if (!channel) {
                    return { skipped: true, reason: 'channel_not_found' };
                }

                if (channel.status !== ChannelStatus.pending) {
                    return { skipped: true, reason: `status=${channel.status}` };
                }

                /* 2️⃣ RESERVATION (LOCK)
                   faqat `queued` bo‘lsa `running` ga o‘tadi */
                const reservation = await prisma.channelVerification.updateMany({
                    where: {
                        channelId,
                        notes: 'queued',
                    },
                    data: {
                        notes: 'running',
                        lastError: null,
                        checkedAt: now,
                    },
                });

                if (reservation.count === 0) {
                    return { skipped: true, reason: 'already_processing' };
                }

                /* 3️⃣ TELEGRAM CHECK */
                const result = await verificationService.verifyChannel(channel);

                /* ============================
                   ✅ SUCCESS
                   ============================ */
                if (result.isAdmin) {
                    await prisma.$transaction(async (tx) => {
                        await tx.channel.update({
                            where: { id: channelId },
                            data: { status: ChannelStatus.verified },
                        });

                        await tx.channelVerification.update({
                            where: { channelId },
                            data: {
                                fraudScore: 0,
                                notes: 'auto_verified',
                                lastError: null,
                                checkedAt: now,
                            },
                        });
                    });

                    return { ok: true };
                }

                /* ============================
                   ❌ NON-RETRYABLE
                   (user action talab qilinadi)
                   ============================ */
                const nonRetryable = new Set<TelegramCheckReason>([
                    TelegramCheckReason.CHAT_NOT_FOUND,
                    TelegramCheckReason.BOT_NOT_ADMIN,
                    TelegramCheckReason.BOT_KICKED,
                ]);

                if (nonRetryable.has(result.reason)) {
                    await prisma.channelVerification.update({
                        where: { channelId },
                        data: {
                            notes: `failed:${result.reason}`,
                            lastError: result.telegramError ?? result.reason,
                            checkedAt: now,
                        },
                    });

                    return {
                        ok: false,
                        retry: false,
                        reason: result.reason,
                    };
                }

                /* ============================
                   🔁 RETRYABLE
                   (RATE_LIMIT / NETWORK / UNKNOWN)
                   ============================ */
                await prisma.channelVerification.update({
                    where: { channelId },
                    data: {
                        notes: `retrying:${result.reason}`,
                        lastError: result.telegramError ?? result.reason,
                        checkedAt: now,
                    },
                });

                // 🔥 MUHIM: throw → BullMQ retry/backoff
                throw new Error(`telegram_retryable:${result.reason}`);
            }),
        {
            connection: redisConnection,
            concurrency: 5,
        },
    );

    /* ============================
       DLQ (PostWorker bilan bir xil)
       ============================ */
    worker.on('failed', async (job, err) => {
        if (!job) return;

        const maxAttempts = job.opts.attempts ?? 1;
        if (job.attemptsMade >= maxAttempts) {
            try {
                await channelVerifyDlq.add(
                    'channel-verify-failed',
                    {
                        channelId: job.data.channelId,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    {
                        jobId: `dlq:${job.id}`,
                        removeOnComplete: true,
                        removeOnFail: false,
                    },
                );

                logger.error(
                    `Moved channel verify job ${job.id} to DLQ after ${job.attemptsMade} attempts`,
                );
            } catch (dlqError) {
                logger.error(
                    'Failed to enqueue channel verify DLQ',
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

    /* ============================
       SHUTDOWN
       ============================ */
    const shutdown = async () => {
        logger.log('Shutting down channel verify worker');
        clearInterval(heartbeatTimer);
        await worker.close();
        await channelVerifyDlq.close();
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    return worker;
}
