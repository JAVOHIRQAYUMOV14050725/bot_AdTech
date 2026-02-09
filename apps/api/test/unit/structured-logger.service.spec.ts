import { StructuredLogger } from '@/common/logging/structured-logger.service';

describe('StructuredLogger data handling', () => {
    it('preserves structured data payloads', () => {
        const logger = new StructuredLogger(['log']);
        const writeSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => true);

        logger.log(
            {
                event: 'structured_logger_data',
                correlationId: 'corr-123',
                data: {
                    method: 'POST',
                    url: 'https://api.click.uz/v2/merchant/invoice/create',
                },
            },
            'StructuredLoggerTest',
        );

        expect(writeSpy).toHaveBeenCalled();
        const payload = JSON.parse(String(writeSpy.mock.calls[0][0]));
        expect(payload.event).toBe('structured_logger_data');
        expect(payload.correlationId).toBe('corr-123');
        expect(payload.data).toMatchObject({
            method: 'POST',
            url: 'https://api.click.uz/v2/merchant/invoice/create',
        });

        writeSpy.mockRestore();
    });
});
