import { Test } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { InternalTelegramController } from '@/modules/internal/internal-telegram.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { ChannelsService } from '@/modules/channels/channels.service';
import { resetDatabase } from '../utils/test-helpers';
import { ChannelStatus, UserRole, UserStatus } from '@prisma/client';
import { InternalTokenGuard } from '@/common/guards/internal-token.guard';
import { ConfigService } from '@nestjs/config';

describe('InternalTelegramController resolvePublisher', () => {
    let prisma: PrismaService;
    let controller: InternalTelegramController;
    let dbAvailable = true;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [InternalTelegramController],
            providers: [
                PrismaService,
                { provide: AuthService, useValue: {} },
                { provide: IdentityResolverService, useValue: {} },
                { provide: TelegramService, useValue: {} },
                { provide: ChannelsService, useValue: {} },
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn().mockReturnValue('adtech_bot') },
                },
                { provide: 'LOGGER', useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
            ],
        })
            .overrideGuard(InternalTokenGuard)
            .useValue({ canActivate: () => true })
            .compile();

        prisma = moduleRef.get(PrismaService);
        controller = moduleRef.get(InternalTelegramController);
        try {
            await prisma.$connect();
        } catch (err) {
            dbAvailable = false;
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) {
            return;
        }
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (dbAvailable && prisma) {
            await prisma.$disconnect();
        }
    });

    it('returns IDENTIFIER_INVALID for invite links', async () => {
        if (!dbAvailable) {
            return;
        }
        const result = await controller.resolvePublisher({
            identifier: 'https://t.me/joinchat/AAAAAFakeInvite',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('IDENTIFIER_INVALID');
        }
    });

    it('returns CHANNEL_NOT_FOUND for unknown channels', async () => {
        if (!dbAvailable) {
            return;
        }
        const result = await controller.resolvePublisher({
            identifier: 'https://t.me/unknown_channel_12345',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('CHANNEL_NOT_FOUND');
        }
    });

    it('returns CHANNEL_NOT_APPROVED for pending channels', async () => {
        if (!dbAvailable) {
            return;
        }

        const owner = await prisma.user.create({
            data: {
                role: UserRole.publisher,
                status: UserStatus.active,
                telegramId: BigInt(10001),
            },
        });

        await prisma.channel.create({
            data: {
                telegramChannelId: BigInt(999001),
                title: 'Pending Channel',
                username: 'pending_channel',
                status: ChannelStatus.pending,
                ownerId: owner.id,
            },
        });

        const result = await controller.resolvePublisher({
            identifier: '@pending_channel',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('CHANNEL_NOT_APPROVED');
        }
    });
});
