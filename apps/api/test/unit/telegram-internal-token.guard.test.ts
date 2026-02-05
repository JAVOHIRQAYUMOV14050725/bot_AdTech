import { TelegramInternalTokenGuard } from '@/modules/auth/guards/telegram-internal-token.guard';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';

const buildContext = (request: Record<string, any>) => ({
    switchToHttp: () => ({
        getRequest: () => request,
    }),
});

describe('TelegramInternalTokenGuard', () => {
    const token = 'internal-token';
    const configService = { get: jest.fn().mockReturnValue(token) };
    const logger = { warn: jest.fn() };
    const guard = new TelegramInternalTokenGuard(configService as any, logger as any);

    it('rejects missing internal token', () => {
        const request = { headers: {}, rawBody: '{}' };
        expect(() => guard.canActivate(buildContext(request) as any)).toThrow(UnauthorizedException);
    });

    it('rejects missing signature headers', () => {
        const request = {
            headers: {
                'x-telegram-internal-token': token,
            },
            rawBody: '{}',
        };
        expect(() => guard.canActivate(buildContext(request) as any)).toThrow(UnauthorizedException);
    });

    it('rejects expired timestamp', () => {
        const timestamp = Math.floor(Date.now() / 1000) - 300;
        const rawBody = '{"telegramId":"123"}';
        const signature = createHmac('sha256', token)
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');

        const request = {
            headers: {
                'x-telegram-internal-token': token,
                'x-telegram-timestamp': timestamp.toString(),
                'x-telegram-signature': signature,
            },
            rawBody,
        };

        expect(() => guard.canActivate(buildContext(request) as any)).toThrow(UnauthorizedException);
    });
});