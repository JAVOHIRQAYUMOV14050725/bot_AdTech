import { KillSwitchKey, Prisma, PrismaClient, UserRole } from '@prisma/client';

const allKillSwitchKeys: KillSwitchKey[] = [
    'payouts',
    'new_escrows',
    'telegram_posting',
    'worker_post',
    'worker_reconciliation',
    'worker_watchdogs',
];

export async function resetDatabase(prisma: PrismaClient) {
    await prisma.postExecutionLog.deleteMany();
    await prisma.postJob.deleteMany();
    await prisma.platformCommission.deleteMany();
    await prisma.escrow.deleteMany();
    await prisma.campaignTarget.deleteMany();
    await prisma.adCreative.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.channelVerification.deleteMany();
    await prisma.channelStatDaily.deleteMany();
    await prisma.channel.deleteMany();
    await prisma.financialAuditEvent.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.userAuditLog.deleteMany();
    await prisma.systemActionLog.deleteMany();
    await prisma.killSwitchEvent.deleteMany();
    await prisma.killSwitch.deleteMany();
    await prisma.user.deleteMany();
}

export async function seedKillSwitches(
    prisma: PrismaClient,
    overrides: Partial<Record<KillSwitchKey, boolean>> = {},
) {
    await prisma.killSwitch.createMany({
        data: allKillSwitchKeys.map((key) => ({
            key,
            enabled: overrides[key] ?? false,
            reason: 'test_seed',
            updatedBy: 'jest',
        })),
    });
}

export async function createUserWithWallet(params: {
    prisma: PrismaClient;
    telegramId: bigint;
    role: UserRole;
    balance: Prisma.Decimal;
}) {
    const { prisma, telegramId, role, balance } = params;
    const user = await prisma.user.create({
        data: {
            telegramId,
            role,
            status: 'active',
        },
    });

    const wallet = await prisma.wallet.create({
        data: {
            userId: user.id,
            balance,
            currency: 'USD',
        },
    });

    if (balance.gt(0)) {
        const ledgerEntry = await prisma.ledgerEntry.create({
            data: {
                walletId: wallet.id,
                type: 'credit',
                amount: balance,
                reason: 'deposit',
                referenceId: `seed:${user.id}`,
            },
        });

        await prisma.financialAuditEvent.create({
            data: {
                walletId: wallet.id,
                ledgerEntryId: ledgerEntry.id,
                type: 'credit',
                amount: balance,
                reason: 'deposit',
                actor: 'seed',
                correlationId: `seed:${user.id}`,
            },
        });
    }

    return { user, wallet };
}

export async function createCampaignTargetScenario(params: {
    prisma: PrismaClient;
    advertiserBalance: Prisma.Decimal;
    publisherBalance: Prisma.Decimal;
    price: Prisma.Decimal;
    creativePayload?: Prisma.JsonObject;
    telegramChannelId?: bigint;
}) {
    const {
        prisma,
        advertiserBalance,
        publisherBalance,
        price,
        creativePayload,
        telegramChannelId,
    } = params;

    const advertiser = await createUserWithWallet({
        prisma,
        telegramId: BigInt(9001),
        role: 'advertiser',
        balance: advertiserBalance,
    });

    const publisher = await createUserWithWallet({
        prisma,
        telegramId: BigInt(9002),
        role: 'publisher',
        balance: publisherBalance,
    });

    const superAdmin = await createUserWithWallet({
        prisma,
        telegramId: BigInt(9003),
        role: 'super_admin',
        balance: new Prisma.Decimal(0),
    });

    const channel = await prisma.channel.create({
        data: {
            telegramChannelId: telegramChannelId ?? BigInt(123456789),
            title: 'Test Channel',
            username: 'test_channel',
            category: 'test',
            subscriberCount: 1000,
            avgViews: 100,
            cpm: new Prisma.Decimal(10),
            status: 'approved',
            ownerId: publisher.user.id,
        },
    });

    const campaign = await prisma.campaign.create({
        data: {
            advertiserId: advertiser.user.id,
            name: 'Test Campaign',
            totalBudget: new Prisma.Decimal(1000),
            status: 'active',
            startAt: new Date(),
        },
    });

    const creative = await prisma.adCreative.create({
        data: {
            campaignId: campaign.id,
            contentType: 'text',
            contentPayload:
                creativePayload ??
                ({ text: 'Hello from integration test' } as Prisma.JsonObject),
        },
    });

    const target = await prisma.campaignTarget.create({
        data: {
            campaignId: campaign.id,
            channelId: channel.id,
            price,
            scheduledAt: new Date(),
            status: 'pending',
        },
    });

    const postJob = await prisma.postJob.create({
        data: {
            campaignTargetId: target.id,
            executeAt: new Date(),
            status: 'queued',
        },
    });

    return {
        advertiser,
        publisher,
        superAdmin,
        channel,
        campaign,
        creative,
        target,
        postJob,
    };
}

export async function waitForCondition(
    predicate: () => Promise<boolean>,
    params?: { timeoutMs?: number; intervalMs?: number },
) {
    const timeoutMs = params?.timeoutMs ?? 30000;
    const intervalMs = params?.intervalMs ?? 500;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('Timed out waiting for condition');
}