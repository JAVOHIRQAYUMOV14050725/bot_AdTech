import { AsyncLocalStorage } from 'async_hooks';

type CorrelationStore = {
    correlationId?: string;
};

export const correlationIdStore = new AsyncLocalStorage<CorrelationStore>();

export const getCorrelationId = (): string | undefined => {
    return correlationIdStore.getStore()?.correlationId;
};

export const runWithCorrelationId = async <T>(
    correlationId: string | undefined,
    fn: () => Promise<T>,
): Promise<T> => {
    return correlationIdStore.run({ correlationId }, fn);
};
