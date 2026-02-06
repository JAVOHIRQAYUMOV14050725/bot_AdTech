
import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdminHandler } from './handlers/admin.handler';
import { PrismaModule } from '@/prisma/prisma.module';
import { OpsModule } from '@/modules/ops/ops.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { loadEnv } from '@/config/env';
import { TelegramFSMService } from '../application/telegram/telegram-fsm.service';
import { RedisModule } from '../redis/redis.module';
import { StartHandler } from './handlers/start.handler';
import { AdvertiserHandler } from './handlers/advertiser.handler';
import { ChannelsModule } from '../channels/channels.module';
import { PublisherHandler } from './handlers/publisher.handler';
import { IdentityModule } from '@/modules/identity/identity.module';
import { TELEGRAM_IDENTITY_ADAPTER } from '@/modules/identity/telegram-identity.adapter';
import { TelegramBackendClient } from './telegram-backend.client';
import { TelegramUserLockService } from './telegram-user-lock.service';

const env = loadEnv();
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

@Module({
    imports: [
        TelegrafModule.forRoot({ token: TELEGRAM_BOT_TOKEN }),
        PrismaModule,
        OpsModule,
        RedisModule,
        forwardRef(() => IdentityModule),
        forwardRef(() => ChannelsModule),
    ],
    providers: [
        TelegramFSMService,
        TelegramBackendClient,
        TelegramUserLockService,
        StartHandler,
        AdvertiserHandler,
        PublisherHandler,
        AdminHandler,
        {
            provide: TELEGRAM_IDENTITY_ADAPTER,
            useExisting: TelegramService,
        },
        TelegramService,
    ],
    exports: [TelegramService, TELEGRAM_IDENTITY_ADAPTER],
})
export class TelegramModule { }
