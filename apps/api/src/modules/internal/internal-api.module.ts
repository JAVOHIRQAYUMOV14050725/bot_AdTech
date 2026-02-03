import { Module } from '@nestjs/common';
import { InternalAdDealController } from './internal-addeal.controller';
import { InternalPaymentsController } from './internal-payments.controller';
import { InternalTelegramController } from './internal-telegram.controller';
import { AdDealModule } from '@/modules/application/addeal/addeal.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { IdentityModule } from '@/modules/identity/identity.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { ChannelsModule } from '@/modules/channels/channels.module';

@Module({
    imports: [
        AdDealModule,
        PaymentsModule,
        AuthModule,
        PrismaModule,
        IdentityModule,
        TelegramModule,
        ChannelsModule,
    ],
    controllers: [
        InternalAdDealController,
        InternalPaymentsController,
        InternalTelegramController,
    ],
})
export class InternalApiModule { }