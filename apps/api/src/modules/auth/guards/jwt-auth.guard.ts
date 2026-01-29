import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { UserStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { jwtConfig } from '@/config/jwt.config';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        @Inject(jwtConfig.KEY) private readonly jwtConfig: ConfigType<typeof jwtConfig>,
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
            const payload = await this.jwtService.verifyAsync(token, {
                secret: this.jwtConfig.access.secret,
                issuer: this.jwtConfig.issuer,
                audience: this.jwtConfig.audience,
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
