import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) { }

    async log(params: {
        userId: string;
        action: string;
        metadata?: Prisma.InputJsonValue;
        ipAddress?: string;
    }) {
        const { userId, action, metadata, ipAddress } = params;
        return this.prisma.userAuditLog.create({
            data: {
                userId,
                action,
                metadata: metadata ?? undefined,
                ipAddress,
            },
        });
    }
}