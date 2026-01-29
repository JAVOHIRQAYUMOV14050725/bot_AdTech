import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import jwtConfig from '@/config/jwt.config';

@Module({
    imports: [
        PrismaModule,
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [jwtConfig.KEY],
            useFactory: (jwt: ConfigType<typeof jwtConfig>) => ({
                secret: jwt.accessSecret,
                signOptions: {
                    expiresIn: jwt.accessExpiresIn,
                    issuer: jwt.issuer,
                    audience: jwt.audience,
                },
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard],
    exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule { }