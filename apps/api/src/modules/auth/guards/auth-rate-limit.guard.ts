import {
    CanActivate,
    ExecutionContext,
    Injectable,
    TooManyRequestsException,
} from '@nestjs/common';
import { Request } from 'express';

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
    private static readonly store = new Map<string, RateLimitEntry>();

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const limit = Number(process.env.AUTH_RATE_LIMIT_LIMIT ?? 5);
        const ttlMs = Number(process.env.AUTH_RATE_LIMIT_TTL_MS ?? 60000);

        const forwarded = request.headers['x-forwarded-for'];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const ip = request.ip ?? forwardedIp ?? 'unknown';
        const key = `${ip}:${request.path}`;
        const now = Date.now();

        const entry = AuthRateLimitGuard.store.get(key);
        if (!entry || now > entry.resetAt) {
            AuthRateLimitGuard.store.set(key, {
                count: 1,
                resetAt: now + ttlMs,
            });
            return true;
        }

        entry.count += 1;
        AuthRateLimitGuard.store.set(key, entry);

        if (entry.count > limit) {
            throw new TooManyRequestsException(
                'Too many requests, please try again later',
            );
        }

        return true;
    }
}
