import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramInternalTokenGuard implements CanActivate {
    constructor(
        private readonly configService: ConfigService,
        @Inject('LOGGER') private readonly logger: LoggerService,
    ) { }

    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const token = request.headers['x-telegram-internal-token'];
        const expected = this.configService.get<string>('TELEGRAM_INTERNAL_TOKEN');

        if (!expected || token !== expected) {
            this.logger.warn(
                {
                    event: 'telegram_internal_auth_failed',
                    context: TelegramInternalTokenGuard.name,
                    data: { reason: 'missing_or_invalid' },
                },
                TelegramInternalTokenGuard.name,
            );
            throw new UnauthorizedException('Invalid telegram internal token');
        }

        return true;
    }
}
