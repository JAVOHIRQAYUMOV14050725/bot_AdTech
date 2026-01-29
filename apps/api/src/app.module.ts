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
    import { RedisModule } from '@/modules/redis/redis.module';
    import { JwtModule } from '@nestjs/jwt';
    import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
    import { LoggingModule } from './common/logging/logging.module';
    import { ThrottlerModule } from '@nestjs/throttler';
    import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
    import { appConfig } from '@/config/app.config';
    import { redisConfig } from '@/config/redis.config';
    import { telegramConfig } from '@/config/telegram.config';
    import { jwtConfig } from '@/config/jwt.config';
    import { authConfig } from '@/config/auth.config';
    import { workerConfig } from '@/config/worker.config';
    import { campaignConfig } from '@/config/campaign.config';
    import { ConfigType } from '@nestjs/config';


    @Module({
        imports: [

            ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env'],
                validate: (config) => envSchema.parse(config),
                load: [
                    appConfig,
                    redisConfig,
                    telegramConfig,
                    jwtConfig,
                    authConfig,
                    workerConfig,
                    campaignConfig,
                ],
            }),
            ThrottlerModule.forRootAsync({
                inject: [redisConfig.KEY],
                useFactory: (redis: ConfigType<typeof redisConfig>) => ({
                    throttlers: [
                        { name: 'default', ttl: 60_000, limit: 60 }, 
                    ],
                    storage: new ThrottlerStorageRedisService({
                        host: redis.host,
                        port: redis.port,
                        password: redis.password,
                    }),
                }),
            }),


            ScheduleModule.forRoot(),
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
        providers: [JwtAuthGuard],
        exports: [JwtModule, JwtAuthGuard],
    })
    export class AppModule { }