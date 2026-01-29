import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { RedisService } from '@/modules/redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { AppThrottlerGuard } from '@/common/guards/app-throttler.guard';

@Global()
@Module({
    imports: [
        ThrottlerModule.forRoot({
            throttlers: [{ ttl: 60, limit: 1000 }],
        }),
    ],
    providers: [
        {
            provide: 'APP_THROTTLER_STORAGE',
            inject: [RedisService],
            useFactory: (redisService: RedisService) =>
                new RedisThrottlerStorage(redisService.getClient()),
        },
        {
            provide: APP_GUARD,
            inject: ['APP_THROTTLER_STORAGE', 'LOGGER', Reflector],
            useFactory: (storage: RedisThrottlerStorage, logger: any, reflector: Reflector) =>
                new AppThrottlerGuard(storage, logger, reflector),
        },
    ],
    exports: [ThrottlerModule],
})
export class ThrottlingModule { }
