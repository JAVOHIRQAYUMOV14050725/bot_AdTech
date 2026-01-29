import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { getJwtConfig } from '@/config/jwt.config';
import { EnvVars } from '@/config/env.schema';

@Module({
    imports: [
        PrismaModule,
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvVars>) => {
                const jwtConfig = getJwtConfig(configService);
                return {
                    secret: jwtConfig.access.secret,
                    signOptions: {
                        expiresIn: jwtConfig.access.expiresIn,
                        issuer: jwtConfig.issuer,
                        audience: jwtConfig.audience,
                    },
                };
            },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard],
    exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule { }
