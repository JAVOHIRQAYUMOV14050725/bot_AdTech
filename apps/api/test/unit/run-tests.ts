import { runCorrelationIdTests } from './correlation-id.test';
import { runRedactionTests } from './redaction.test';

const run = () => {
    runCorrelationIdTests();
    runRedactionTests();
};

run();