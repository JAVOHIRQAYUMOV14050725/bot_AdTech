import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ThrottlerStorageRedisService } from 'throttler-storage-redis';
import redisConfig from '@/config/redis.config';

@Global()
@Module({
    imports: [
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [redisConfig.KEY],
            useFactory: (redis: ConfigType<typeof redisConfig>) => ({
                throttlers: [
                    {
                        ttl: 60,
                        limit: 1000,
                    },
                ],
                storage: new ThrottlerStorageRedisService({
                    host: redis.host,
                    port: redis.port,
                    password: redis.password,
                }),
            }),
        }),
    ],
    exports: [ThrottlerModule],
})
export class ThrottlingModule {}
