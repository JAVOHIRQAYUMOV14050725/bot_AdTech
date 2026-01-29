import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { UserStatus } from '@prisma/client';
import { ConfigService, ConfigType } from '@nestjs/config';
import jwtConfig from '@/config/jwt.config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers?.authorization;

        if (!authHeader || typeof authHeader !== 'string') {
            throw new UnauthorizedException('Missing Authorization header');
        }

        const [scheme, token] = authHeader.split(' ');
        if (scheme !== 'Bearer' || !token) {
            throw new UnauthorizedException('Invalid Authorization header');
        }

        try {
            const jwt = this.configService.getOrThrow<ConfigType<typeof jwtConfig>>(
                jwtConfig.KEY,
                { infer: true },
            );

            const payload = await this.jwtService.verifyAsync(token, {
                secret: jwt.accessSecret,
                issuer: jwt.issuer,
                audience: jwt.audience,
            });
            const userId = payload?.sub as string | undefined;

            if (!userId || payload?.typ !== 'access') {
                throw new UnauthorizedException('Invalid token');
            }

            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    role: true,
                    telegramId: true,
                    status: true,
                },
            });

            if (!user || user.status !== UserStatus.active) {
                throw new UnauthorizedException('Invalid user');
            }

            request.user = {
                id: user.id,
                role: user.role,
                telegramId: user.telegramId,
            };

            return true;
        } catch (err) {
            if (err instanceof UnauthorizedException) {
                throw err;
            }
            throw new UnauthorizedException('Invalid token');
        }
    }
}
