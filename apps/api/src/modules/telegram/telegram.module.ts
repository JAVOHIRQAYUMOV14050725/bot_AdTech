
import { PaymentsModule } from '@/modules/payments/payments.module';
import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdminHandler } from './handlers/admin.handler';
import { PrismaModule } from '@/prisma/prisma.module';
import { OpsModule } from '@/modules/ops/ops.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { loadEnv } from '@/config/env';
import { TelegramUpdate } from './telegram.update';

const env = loadEnv()
const TELEGRAM_BOT_TOKEN =env.TELEGRAM_BOT_TOKEN
console.log('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN)

@Module({
    imports: [
        TelegrafModule.forRoot({
            token: TELEGRAM_BOT_TOKEN,
        }),
        PrismaModule,
        PaymentsModule,
        OpsModule,
    ],
    providers: [
        TelegramService,
        AdminHandler,
        TelegramUpdate,
    ],
    exports: [TelegramService], // ✅ MUHIM

})
export class TelegramModule { }
