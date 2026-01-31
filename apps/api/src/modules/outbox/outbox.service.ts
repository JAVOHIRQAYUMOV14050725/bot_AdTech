import { Prisma, OutboxEvent } from '@prisma/client';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { postQueue } from '@/modules/scheduler/queues';
import { workerConfig } from '@/config/worker.config';
import { ConfigType } from '@nestjs/config';

type PostEnqueuePayload = {
    postJobId: string;
    executeAt: string;
};

@Injectable()
export class OutboxService {
    private readonly batchSize = 25;
    private readonly lockTimeoutMs = 5 * 60 * 1000;

    constructor(
        private readonly prisma: PrismaService,
        @Inject(workerConfig.KEY)
        private readonly workerSettings: ConfigType<typeof workerConfig>,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

    async enqueuePostJob(
        tx: Prisma.TransactionClient,
        postJobId: string,
        executeAt: Date,
    ) {
        const dedupeKey = `post_enqueue:${postJobId}`;
        const event = await tx.outboxEvent.upsert({
            where: { dedupeKey },
            update: {},
            create: {
                eventType: 'post_enqueue',
                dedupeKey,
                payload: {
                    postJobId,
                    executeAt: executeAt.toISOString(),
                },
            },
        });

        this.logger.log(
            {
                event: 'outbox_event_created',
                entityType: 'outbox_event',
                entityId: event.id,
                data: {
                    eventType: event.eventType,
                    dedupeKey: event.dedupeKey,
                    postJobId,
                    executeAt: executeAt.toISOString(),
                },
            },
            'OutboxService',
        );

        return event;
    }

    async processPending() {
        const events = await this.reserveBatch();
        for (const event of events) {
            await this.dispatch(event);
        }
    }

    private async reserveBatch(): Promise<OutboxEvent[]> {
        const cutoff = new Date(Date.now() - this.lockTimeoutMs);
        return this.prisma.$transaction(async (tx) => {
            const events = await tx.$queryRaw<OutboxEvent[]>`
                SELECT *
                FROM outbox_events
                WHERE status IN ('pending', 'processing')
                  AND (status = 'pending' OR "lockedAt" < ${cutoff})
                ORDER BY "createdAt" ASC
                LIMIT ${this.batchSize}
                FOR UPDATE SKIP LOCKED
            `;

            if (events.length === 0) {
                return [];
            }

            await tx.outboxEvent.updateMany({
                where: { id: { in: events.map((event) => event.id) } },
                data: {
                    status: 'processing',
                    lockedAt: new Date(),
                    attempts: { increment: 1 },
                },
            });

            return events;
        });
    }

    private async dispatch(event: OutboxEvent) {
        try {
            if (event.eventType === 'post_enqueue') {
                const payload = event.payload as Prisma.JsonObject as PostEnqueuePayload;
                const executeAt = new Date(payload.executeAt);
                const delay = Math.max(executeAt.getTime() - Date.now(), 0);
                const queueName = postQueue.name;
                const jobName = 'execute-post';
                const correlationId = `job:${queueName}:${payload.postJobId}`;

                await postQueue.add(
                    jobName,
                    { postJobId: payload.postJobId },
                    {
                        jobId: payload.postJobId,
                        delay,
                        attempts: this.workerSettings.postJobMaxAttempts,
                        backoff: {
                            type: 'exponential',
                            delay: this.workerSettings.postJobRetryBackoffMs,
                        },
                        removeOnComplete: true,
                        removeOnFail: false,
                    },
                );

                this.logger.log(
                    {
                        event: 'post_job_enqueued',
                        correlationId,
                        entityType: 'post_job',
                        entityId: payload.postJobId,
                        data: {
                            queue: queueName,
                            jobName,
                            jobId: payload.postJobId,
                            attempt: 0,
                            delay,
                            durationMs: 0,
                            maxAttempts: this.workerSettings.postJobMaxAttempts,
                        },
                    },
                    'OutboxService',
                );
            } else {
                this.logger.warn(
                    {
                        event: 'outbox_event_unknown',
                        outboxEventId: event.id,
                        eventType: event.eventType,
                    },
                    'OutboxService',
                );
            }

            await this.prisma.outboxEvent.update({
                where: { id: event.id },
                data: {
                    status: 'completed',
                    processedAt: new Date(),
                    lockedAt: null,
                    lastError: null,
                },
            });

            this.logger.log(
                {
                    event: 'outbox_dispatched',
                    entityType: 'outbox_event',
                    entityId: event.id,
                    data: {
                        eventType: event.eventType,
                        status: 'completed',
                    },
                },
                'OutboxService',
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.prisma.outboxEvent.update({
                where: { id: event.id },
                data: {
                    status: 'pending',
                    lockedAt: null,
                    lastError: message,
                },
            });
            this.logger.error(
                {
                    event: 'outbox_dispatch_failed',
                    outboxEventId: event.id,
                    eventType: event.eventType,
                    error: message,
                },
                err instanceof Error ? err.stack : undefined,
                'OutboxService',
            );
        }
    }
}
