import { AuthModule } from '@/modules/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { RedisModule } from '@/modules/redis/redis.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { LoggingModule } from './common/logging/logging.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'throttler-storage-redis';
import { buildRedisConnection } from './config/redis.config';
import { EnvVars } from './config/env.schema';
import { ThrottlerLoggerGuard } from './common/guards/throttler-logger.guard';


@Module({
    imports: [

        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env'],
            validate: (config) => envSchema.parse(config),
        }),

        ScheduleModule.forRoot(),
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvVars>) => ({
                ttl: 60,
                limit: 100,
                storage: new ThrottlerStorageRedisService(
                    buildRedisConnection(configService),
                ),
            }),
        }),
        LoggingModule,
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
        RedisModule,
        HealthModule,
        JwtModule
    ],
    providers: [JwtAuthGuard, ThrottlerLoggerGuard],
    exports: [JwtModule,JwtAuthGuard],
})
export class AppModule { }
