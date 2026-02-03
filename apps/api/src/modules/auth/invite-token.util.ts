import { BadRequestException } from '@nestjs/common';

export function assertInviteTokenUsable(params: {
    usedAt: Date | null;
    expiresAt: Date;
}) {
    if (params.usedAt) {
        throw new BadRequestException('Invite token already used');
    }

    if (params.expiresAt <= new Date()) {
        throw new BadRequestException('Invite token expired');
    }
}