
import { PaymentsCoreModule } from '@/modules/payments/payments-core.module';
import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdminHandler } from './handlers/admin.handler';
import { PrismaModule } from '@/prisma/prisma.module';
import { OpsModule } from '@/modules/ops/ops.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { loadEnv } from '@/config/env';
import { TelegramUpdate } from './telegram.update';
import { TelegramFSMService } from '../application/telegram/telegram-fsm.service';
import { RedisModule } from '../redis/redis.module';
import { StartHandler } from './handlers/start.handler';
import { AdvertiserHandler } from './handlers/advertiser.handler';
import { ChannelsModule } from '../channels/channels.module';
import { PublisherHandler } from './handlers/publisher.handler';
import { AdDealModule } from '../application/addeal/addeal.module';
import { IdentityModule } from '@/modules/identity/identity.module';

const env = loadEnv()
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN
console.log('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN)

@Module({
    imports: [
        TelegrafModule.forRoot({ token: TELEGRAM_BOT_TOKEN }),
        PrismaModule,
        PaymentsCoreModule,
        OpsModule,
        RedisModule,
        AdDealModule,
        forwardRef(() => IdentityModule),
        forwardRef(() => ChannelsModule),
    ],
    providers: [
        TelegramFSMService,
        StartHandler,
        AdvertiserHandler,
        PublisherHandler,
        AdminHandler,
        TelegramService,
    ],
    exports: [TelegramService],
})
export class TelegramModule { }