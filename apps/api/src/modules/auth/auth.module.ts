import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { jwtConfig } from '@/config/jwt.config';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';

@Module({
    imports: [
        PrismaModule,
        ConfigModule,
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
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard, RateLimitGuard],
    exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule { }