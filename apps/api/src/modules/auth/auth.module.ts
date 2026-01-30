import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { jwtConfig } from '@/config/jwt.config';
import { ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from '@/config/env';
import { LoggingModule } from '@/common/logging/logging.module';
@Module({
    imports: [
        PrismaModule,
        ConfigModule,
        ThrottlerModule.forRoot({
            throttlers: [
                {
                    ttl: Math.ceil(loadEnv().AUTH_RATE_LIMIT_TTL_MS / 1000),
                    limit: loadEnv().AUTH_RATE_LIMIT_LIMIT,
                },
            ],
        }),

        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [jwtConfig.KEY],
            useFactory: (config: ConfigType<typeof jwtConfig>) => ({
                secret: config.access.secret,
                signOptions: {
                    expiresIn: config.access.expiresIn,
                    issuer: config.issuer,
                    audience: config.audience,
                },
            }),
        }),
        LoggingModule
        
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard],
    exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule { }