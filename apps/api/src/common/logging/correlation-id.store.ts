import { randomUUID } from 'crypto';
import {
    RequestContext,
    runWithWorkerContext,
} from '@/common/context/request-context';

export const getCorrelationId = (): string | undefined =>
    RequestContext.getCorrelationId();

export const runWithCorrelationId = async <T>(
    correlationId: string | undefined,
    fn: () => Promise<T>,
): Promise<T> =>
    RequestContext.runWithContext(
        { correlationId: correlationId ?? randomUUID() },
        fn,
    );

export { runWithWorkerContext };
