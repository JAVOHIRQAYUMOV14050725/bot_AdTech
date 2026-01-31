import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export type RequestContextStore = {
    correlationId: string;
    actorId?: string;
};

const requestContextStore = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
    runWithContext<T>(
        context: Partial<RequestContextStore>,
        fn: () => T,
    ): T {
        const existing = requestContextStore.getStore() ?? {
            correlationId: randomUUID(),
        };
        const nextContext = {
            ...existing,
            ...context,
        } as RequestContextStore;

        return requestContextStore.run(nextContext, fn);
    },
    getCorrelationId(): string | undefined {
        return requestContextStore.getStore()?.correlationId;
    },
    setCorrelationId(correlationId: string) {
        const store = requestContextStore.getStore();
        if (store) {
            store.correlationId = correlationId;
        }
    },
    getActorId(): string | undefined {
        return requestContextStore.getStore()?.actorId;
    },
    setActorId(actorId: string | undefined) {
        const store = requestContextStore.getStore();
        if (store) {
            store.actorId = actorId;
        }
    },
};

export const buildCronCorrelationId = (jobName: string) =>
    `cron:${jobName}:${Date.now()}`;

export const buildWorkerCorrelationId = (
    queue: string,
    jobId: string | number | undefined,
) => `job:${queue}:${jobId ?? randomUUID()}`;

export const runWithCronContext = async <T>(
    jobName: string,
    fn: () => Promise<T>,
): Promise<T> =>
    RequestContext.runWithContext(
        { correlationId: buildCronCorrelationId(jobName) },
        fn,
    );

export const runWithWorkerContext = async <T>(
    queue: string,
    jobId: string | number | undefined,
    fn: () => Promise<T>,
): Promise<T> =>
    RequestContext.runWithContext(
        { correlationId: buildWorkerCorrelationId(queue, jobId) },
        fn,
    );
