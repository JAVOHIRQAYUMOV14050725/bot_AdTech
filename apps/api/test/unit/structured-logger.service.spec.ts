import { StructuredLogger } from '@/common/logging/structured-logger.service';

describe('StructuredLogger', () => {
    it('preserves data payload fields inside the structured output', () => {
        const logger = new StructuredLogger(['log']);
        const writeSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => true as never);

        logger.log({
            event: 'test_event',
            correlationId: 'corr-123',
            context: 'StructuredLoggerTest',
            data: {
                method: 'POST',
                url: 'https://example.com/v1/test',
            },
        });

        expect(writeSpy).toHaveBeenCalled();
        const payload = JSON.parse(String(writeSpy.mock.calls[0][0]));
        expect(payload.event).toBe('test_event');
        expect(payload.correlationId).toBe('corr-123');
        expect(payload.data).toEqual({
            method: 'POST',
            url: 'https://example.com/v1/test',
        });

        writeSpy.mockRestore();
    });
});
