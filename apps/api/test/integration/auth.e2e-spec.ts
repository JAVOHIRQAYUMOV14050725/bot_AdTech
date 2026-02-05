import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthService } from '@/modules/auth/auth.service';
import { authConfig } from '@/config/auth.config';
import { jwtConfig } from '@/config/jwt.config';
import { resetDatabase } from '../utils/test-helpers';
import bcrypt from 'bcrypt';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { IdentityResolverService } from '@/modules/identity/identity-resolver.service';

describe('Auth integration (bootstrap/login/invite/telegram)', () => {
    let prisma: PrismaService;
    let authService: AuthService;
    let dbAvailable = true;
    const identityResolver = {
        resolveUserIdentifier: jest.fn(),
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                PrismaService,
                AuthService,
                { provide: JwtService, useValue: new JwtService({}) },
                {
                    provide: jwtConfig.KEY,
                    useValue: {
                        access: { secret: 'access-secret', expiresIn: '1h' },
                        refresh: { secret: 'refresh-secret', expiresIn: '7d' },
                        issuer: 'test',
                        audience: 'test',
                    },
                },
                {
                    provide: authConfig.KEY,
                    useValue: {
                        bcryptSaltRounds: 4,
                        bootstrapToken: 'bootstrap-token',
                        inviteTokenTtlHours: 1,
                        allowPublicAdvertisers: true,
                        telegramBotUsername: '@adtech_bot',
                        telegramInternalToken: 'internal-token',
                    },
                },
                { provide: 'LOGGER', useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
                { provide: IdentityResolverService, useValue: identityResolver },
            ],
        }).compile();

        prisma = moduleRef.get(PrismaService);
        authService = moduleRef.get(AuthService);
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
        identityResolver.resolveUserIdentifier.mockReset();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        if (dbAvailable) {
            await prisma.$disconnect();
        }
    });

    it('bootstraps super admin once without Telegram dependency', async () => {
        if (!dbAvailable) {
            return;
        }
        const result = await authService.bootstrapSuperAdmin({
            username: 'superadmin',
            password: 'StrongPassw0rd!',
            bootstrapSecret: 'bootstrap-token',
        });

        expect(result.user.role).toBe(UserRole.super_admin);
        expect(result.user.telegramId).toBeNull();
        expect(result.deepLink).toContain('adtech_bot');
        expect(result.deepLink).toContain('BOOTSTRAP');
        expect(identityResolver.resolveUserIdentifier).not.toHaveBeenCalled();

        const gate = await prisma.bootstrapState.findUnique({ where: { id: 1 } });
        expect(gate?.superAdminUserId).toBe(result.user.id);
    });

    it('returns 409 on second bootstrap attempt', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.bootstrapSuperAdmin({
            username: 'superadmin',
            password: 'StrongPassw0rd!',
            bootstrapSecret: 'bootstrap-token',
        });

        await expect(
            authService.bootstrapSuperAdmin({
                username: 'another',
                password: 'StrongPassw0rd!',
                bootstrapSecret: 'bootstrap-token',
            }),
        ).rejects.toThrow(ConflictException);
    });

    it('allows super_admin login without telegramId', async () => {
        if (!dbAvailable) {
            return;
        }
        const passwordHash = await bcrypt.hash('StrongPassw0rd!', 4);
        const user = await prisma.user.create({
            data: {
                role: UserRole.super_admin,
                status: UserStatus.active,
                username: 'superadmin',
                passwordHash,
                superAdminKey: 'super_admin',
            },
        });
        await prisma.userRoleGrant.create({
            data: { userId: user.id, role: UserRole.super_admin },
        });

        const result = await authService.login({
            identifier: 'superadmin',
            password: 'StrongPassw0rd!',
        });

        expect(result.user.id).toBe(user.id);
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
    });

    it('invites publisher and activates on telegram start', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9001',
            username: '@publisher1',
            startPayload: null,
        });

        const invite = await authService.invitePublisher({ username: 'publisher1' });

        expect(invite.deepLink).toContain('https://t.me/adtech_bot?start=');
        expect(invite.deepLink).toContain(invite.inviteToken);
        expect(invite.deepLink).not.toContain('@');

        const inviteRow = await prisma.userInvite.findFirst({
            where: { intendedUsernameNormalized: 'publisher1' },
        });
        expect(inviteRow?.intendedRole).toBe(UserRole.publisher);
        expect(inviteRow?.intendedUsernameNormalized).toBe('publisher1');
        expect(inviteRow?.boundTelegramId?.toString()).toBe('9001');

        const linked = await authService.handleTelegramStart({
            telegramId: '9001',
            username: '@pub_tg',
            startPayload: invite.inviteToken,
        });

        const after = await prisma.user.findUnique({ where: { telegramId: BigInt(9001) } });
        const usedInvite = await prisma.userInvite.findFirst({
            where: { intendedUsernameNormalized: 'publisher1' },
        });

        expect(linked.user.role).toBe(UserRole.publisher);
        expect(linked.user.roles).toEqual(expect.arrayContaining([UserRole.publisher]));
        expect(linked.user.status).toBe(UserStatus.active);
        expect(after?.telegramId?.toString()).toBe('9001');
        expect(usedInvite?.usedAt).not.toBeNull();
    });

    it('is idempotent for repeated telegram start', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9101',
            username: '@publisher2',
            startPayload: null,
        });

        const invite = await authService.invitePublisher({ username: 'publisher2' });

        const first = await authService.handleTelegramStart({
            telegramId: '9101',
            username: '@pub2',
            startPayload: invite.inviteToken,
        });

        const second = await authService.handleTelegramStart({
            telegramId: '9101',
            username: '@pub2',
            startPayload: invite.inviteToken,
        });

        const invites = await prisma.userInvite.findMany({ where: { intendedUsernameNormalized: 'publisher2' } });

        expect(first.user.id).toBe(second.user.id);
        expect(first.idempotent).toBe(false);
        expect(second.idempotent).toBe(true);
        expect(invites).toHaveLength(1);
    });

    it('creates advertiser on /start only once (idempotent)', async () => {
        if (!dbAvailable) {
            return;
        }
        const first = await authService.handleTelegramStart({
            telegramId: '9201',
            username: '@adv_user',
            startPayload: null,
        });
        const second = await authService.handleTelegramStart({
            telegramId: '9201',
            username: '@adv_user',
            startPayload: null,
        });

        const users = await prisma.user.findMany({ where: { telegramId: BigInt(9201) } });
        const grants = await prisma.userRoleGrant.findMany({ where: { userId: users[0].id } });

        expect(first.created).toBe(true);
        expect(second.idempotent).toBe(true);
        expect(users).toHaveLength(1);
        expect(grants.map((grant) => grant.role)).toContain(UserRole.advertiser);
    });

    it('links publisher invite to existing advertiser user without duplicates', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9301',
            username: '@advertiser_one',
            startPayload: null,
        });

        const invite = await authService.invitePublisher({ username: '@PublisherOne' });

        const linked = await authService.handleTelegramStart({
            telegramId: '9301',
            username: '@PublisherOne',
            startPayload: invite.inviteToken,
        });

        const users = await prisma.user.findMany({ where: { telegramId: BigInt(9301) } });
        const grants = await prisma.userRoleGrant.findMany({ where: { userId: users[0].id } });
        const invites = await prisma.userInvite.findMany({ where: { intendedUsernameNormalized: 'publisherone' } });

        expect(users).toHaveLength(1);
        expect(invites).toHaveLength(1);
        expect(linked.user.roles).toEqual(expect.arrayContaining([UserRole.advertiser, UserRole.publisher]));
        expect(grants.map((grant) => grant.role)).toEqual(expect.arrayContaining([UserRole.advertiser, UserRole.publisher]));
    });

    it('dedupes repeated invites and links idempotently', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9401',
            username: '@repeat_user',
            startPayload: null,
        });
        const firstInvite = await authService.invitePublisher({ username: '@repeat_user' });
        const secondInvite = await authService.invitePublisher({ username: '@repeat_user' });

        const invites = await prisma.userInvite.findMany({ where: { intendedUsernameNormalized: 'repeat_user' } });
        expect(invites).toHaveLength(1);

        const firstLink = await authService.handleTelegramStart({
            telegramId: '9401',
            username: '@repeat_user',
            startPayload: secondInvite.inviteToken,
        });
        const secondLink = await authService.handleTelegramStart({
            telegramId: '9401',
            username: '@repeat_user',
            startPayload: secondInvite.inviteToken,
        });

        const users = await prisma.user.findMany({ where: { telegramId: BigInt(9401) } });
        const usedInvite = await prisma.userInvite.findFirst({ where: { intendedUsernameNormalized: 'repeat_user' } });

        expect(firstInvite.inviteToken).toBe(secondInvite.inviteToken);
        expect(firstLink.idempotent).toBe(false);
        expect(secondLink.idempotent).toBe(true);
        expect(users).toHaveLength(1);
        expect(usedInvite?.usedAt).not.toBeNull();
    });

    it('normalizes usernames with @, casing, and t.me links', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9501',
            username: '@TeSt_User',
            startPayload: null,
        });
        const invite = await authService.invitePublisher({ username: ' https://t.me/TeSt_User ' });
        const inviteRow = await prisma.userInvite.findUnique({ where: { id: invite.invite.id } });

        expect(invite.inviteToken).toBeDefined();
        expect(inviteRow?.intendedUsernameNormalized).toBe('test_user');

        const linked = await authService.handleTelegramStart({
            telegramId: '9501',
            username: '@TeSt_User',
            startPayload: invite.inviteToken,
        });

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(9501) } });
        expect(user?.username).toBe('test_user');
        expect(linked.user.roles).toEqual(expect.arrayContaining([UserRole.publisher]));
    });

    it('records telegram session on start and binds invite to telegramId', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9701',
            username: '@session_user',
            startPayload: null,
        });

        const session = await prisma.telegramSession.findUnique({
            where: { telegramId: BigInt(9701) },
        });
        expect(session?.usernameNormalized).toBe('session_user');

        const invite = await authService.invitePublisher({ username: '@session_user' });
        const inviteRow = await prisma.userInvite.findUnique({ where: { id: invite.invite.id } });
        expect(inviteRow?.boundTelegramId?.toString()).toBe('9701');
    });

    it('rejects invite redemption from wrong telegram account', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9801',
            username: '@owner_user',
            startPayload: null,
        });

        const invite = await authService.invitePublisher({ username: '@owner_user' });

        await expect(
            authService.handleTelegramStart({
                telegramId: '9802',
                username: '@intruder',
                startPayload: invite.inviteToken,
            }),
        ).rejects.toThrow(ForbiddenException);

        const inviteRow = await prisma.userInvite.findUnique({ where: { id: invite.invite.id } });
        expect(inviteRow?.usedAt).toBeNull();
        const intruder = await prisma.user.findUnique({ where: { telegramId: BigInt(9802) } });
        expect(intruder).toBeNull();
    });

    it('allows invite redemption for bound telegram account and is idempotent', async () => {
        if (!dbAvailable) {
            return;
        }
        await authService.handleTelegramStart({
            telegramId: '9901',
            username: '@bound_user',
            startPayload: null,
        });

        const invite = await authService.invitePublisher({ username: '@bound_user' });

        const first = await authService.handleTelegramStart({
            telegramId: '9901',
            username: '@bound_user',
            startPayload: invite.inviteToken,
        });
        const second = await authService.handleTelegramStart({
            telegramId: '9901',
            username: '@bound_user',
            startPayload: invite.inviteToken,
        });

        const inviteRow = await prisma.userInvite.findUnique({ where: { id: invite.invite.id } });
        expect(inviteRow?.usedAt).not.toBeNull();
        expect(first.idempotent).toBe(false);
        expect(second.idempotent).toBe(true);
    });

    it('links super admin on BOOTSTRAP start', async () => {
        if (!dbAvailable) {
            return;
        }
        const bootstrap = await authService.bootstrapSuperAdmin({
            username: 'rootadmin',
            password: 'StrongPassw0rd!',
            bootstrapSecret: 'bootstrap-token',
        });

        const linked = await authService.handleTelegramStart({
            telegramId: '9601',
            username: '@root_admin',
            startPayload: 'BOOTSTRAP',
        });

        const user = await prisma.user.findUnique({ where: { id: bootstrap.user.id } });
        expect(linked.user.role).toBe(UserRole.super_admin);
        expect(user?.telegramId?.toString()).toBe('9601');
    });
});