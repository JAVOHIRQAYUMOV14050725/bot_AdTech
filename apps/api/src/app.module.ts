import { AuthModule } from '@/modules/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { UsersModule } from '@/modules/users/users.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { CampaignsModule } from '@/modules/campaigns/campaigns.module';
import { ModerationModule } from '@/modules/moderation/moderation.module';
import { envSchema } from '@/config/env.schema';
import { HealthModule } from '@/health/health.module';

import { PaymentsModule } from '@/modules/payments/payments.module';

import { TelegramModule } from '@/modules/telegram/telegram.module';

import { SchedulerModule } from '@/modules/scheduler/scheduler.module';

import { SystemModule } from '@/modules/system/system.module';

@Module({
    imports: [

        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env'],
            validate: (config) => envSchema.parse(config),
        }),

        ScheduleModule.forRoot(),
        PrismaModule,
        AuthModule,
        UsersModule,
        ChannelsModule,
        CampaignsModule,
        ModerationModule,
        PaymentsModule,
        TelegramModule,
        SchedulerModule,
        SystemModule,
        HealthModule,
    ],
})
export class AppModule { }