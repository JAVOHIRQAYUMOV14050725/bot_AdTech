import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class TelegramInternalTokenGuard implements CanActivate {
    constructor(
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const token = request.headers['x-telegram-internal-token'];
        const timestamp = request.headers['x-telegram-timestamp'];
        const signature = request.headers['x-telegram-signature'];
        const expected = this.configService.get<string>('TELEGRAM_INTERNAL_TOKEN');

        const tokenValue = typeof token === 'string' ? token : Array.isArray(token) ? token[0] : null;
        const tokenValid =
            typeof expected === 'string'
            && typeof tokenValue === 'string'
            && tokenValue.length === expected.length
            && timingSafeEqual(Buffer.from(tokenValue, 'utf8'), Buffer.from(expected, 'utf8'));

        if (!expected || !tokenValue || !tokenValid) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'missing_or_invalid_token' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException({
                code: 'INVALID_TELEGRAM_INTERNAL_TOKEN',
                message: 'Invalid telegram internal token',
            });
        }

        const timestampValueRaw = Array.isArray(timestamp) ? timestamp[0] : timestamp;
        const signatureValue = Array.isArray(signature) ? signature[0] : signature;

        if (!timestampValueRaw || !signatureValue) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'missing_signature_headers' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException({
                code: 'INVALID_TELEGRAM_INTERNAL_TOKEN',
                message: 'Missing telegram signature headers',
            });
        }

        const timestampValue = Number(timestampValueRaw);
        if (!Number.isFinite(timestampValue)) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'invalid_timestamp' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException({
                code: 'INVALID_TELEGRAM_INTERNAL_TOKEN',
                message: 'Invalid telegram timestamp',
            });
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSeconds - timestampValue) > 120) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'timestamp_expired' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException({
                code: 'INVALID_TELEGRAM_INTERNAL_TOKEN',
                message: 'Telegram timestamp expired',
            });
        }

        const rawBody =
            typeof request.rawBody === 'string'
                ? request.rawBody
                : JSON.stringify(request.body ?? {});
        const expectedSignature = createHmac('sha256', expected)
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
        const signatureBuffer = Buffer.from(signatureValue, 'utf8');
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const signatureValid =
            signatureBuffer.length === expectedBuffer.length &&
            timingSafeEqual(signatureBuffer, expectedBuffer);

        if (!signatureValid) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'invalid_signature' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException({
                code: 'INVALID_TELEGRAM_INTERNAL_TOKEN',
                message: 'Invalid telegram signature',
            });
        }

        return true;
    }
}