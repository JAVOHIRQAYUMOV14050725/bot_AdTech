import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@/modules/domain/contracts';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request?.user;
        if (!user) {
            throw new UnauthorizedException('Authentication required');
        }

        const roles: UserRole[] = Array.isArray(user.roles) && user.roles.length > 0
            ? user.roles
            : [user.role];

        if (!requiredRoles.some((role) => roles.includes(role))) {
            throw new ForbiddenException('Insufficient role');
        }

        return true;
    }
}