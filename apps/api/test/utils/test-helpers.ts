import { KillSwitchKey, Prisma, PrismaClient, UserRole } from '@prisma/client';

export type PrismaTx = PrismaClient | Prisma.TransactionClient;

let telegramSeq = BigInt(Date.now());
function nextTelegramId(): bigint {
    telegramSeq += BigInt(1);
    return telegramSeq;
}
const allKillSwitchKeys: KillSwitchKey[] = [
    'payouts',
    'new_escrows',
    'telegram_posting',
    'worker_post',
    'worker_reconciliation',
    'worker_watchdogs',
];

export async function resetDatabase(prisma: PrismaClient) {
    // deepest children
    await prisma.postExecutionLog.deleteMany();
    await prisma.postJob.deleteMany();
    await prisma.escrow.deleteMany();

    // finance
    await prisma.financialAuditEvent.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.platformCommission.deleteMany();

    // campaign graph
    await prisma.campaignTarget.deleteMany();
    await prisma.adCreative.deleteMany();
    await prisma.campaign.deleteMany();

    // channel graph
    await prisma.channelStatDaily.deleteMany();
    await prisma.channelVerification.deleteMany();
    await prisma.channel.deleteMany();

    // logs
    await prisma.userAuditLog.deleteMany();
    await prisma.systemActionLog.deleteMany();

    // ops
    await prisma.killSwitchEvent.deleteMany();
    await prisma.killSwitch.deleteMany();

    // ROOT
    await prisma.bootstrapState.deleteMany();
    await prisma.user.deleteMany();
}









export async function seedKillSwitches(
    prisma: PrismaClient,
    overrides: Partial<Record<KillSwitchKey, boolean>> = {},
) {
    for (const key of allKillSwitchKeys) {
        await prisma.killSwitch.upsert({
            where: { key },
            update: {
                enabled: overrides[key] ?? false,
                updatedBy: 'jest',
                reason: 'test_seed',
            },
            create: {
                key,
                enabled: overrides[key] ?? false,
                updatedBy: 'jest',
                reason: 'test_seed',
            },
        });
    }
}


export async function createUserWithWallet(params: {
    prisma: PrismaTx;
    role: UserRole;
    balance: Prisma.Decimal;
    telegramId?: bigint;
}) {
    const { prisma, role, balance } = params;
    const telegramId = params.telegramId ?? nextTelegramId();

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
        const ledger = await prisma.ledgerEntry.create({
            data: {
                walletId: wallet.id,
                type: 'credit',
                amount: balance,
                reason: 'deposit',
                referenceId: `seed:${user.id}`,
                idempotencyKey: `seed:ledger:${user.id}`,
            },
        });

        await prisma.financialAuditEvent.create({
            data: {
                walletId: wallet.id,
                ledgerEntryId: ledger.id,
                type: 'credit',
                amount: balance,
                reason: 'deposit',
                actor: 'seed',
                correlationId: `seed:${user.id}`,
                idempotencyKey: `seed:audit:${user.id}`,
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
}) {
    const { prisma, advertiserBalance, publisherBalance, price, creativePayload } = params;

    return prisma.$transaction(async (tx) => {
        const advertiser = await createUserWithWallet({
            prisma: tx,
            role: 'advertiser',
            balance: advertiserBalance,
        });

        const publisher = await createUserWithWallet({
            prisma: tx,
            role: 'publisher',
            balance: publisherBalance,
        });

        const channel = await tx.channel.create({
            data: {
                telegramChannelId: BigInt(Date.now()),
                title: 'Test Channel',
                username: `test_${Date.now()}`,
                category: 'test',
                subscriberCount: 1000,
                avgViews: 100,
                cpm: new Prisma.Decimal(10),
                status: 'approved',
                ownerId: publisher.user.id,
            },
        });

        const campaign = await tx.campaign.create({
            data: {
                advertiserId: advertiser.user.id,
                name: 'Test Campaign',
                totalBudget: new Prisma.Decimal(1000),
                status: 'active',
                startAt: new Date(),
            },
        });

        const creative = await tx.adCreative.create({
            data: {
                campaignId: campaign.id,
                contentType: 'text',
                contentPayload:
                    creativePayload ??
                    ({ text: 'Hello from test' } as Prisma.JsonObject),
            },
        });

        const target = await tx.campaignTarget.create({
            data: {
                campaignId: campaign.id,
                channelId: channel.id,
                price,
                scheduledAt: new Date(),
                status: 'submitted',
            },
        });

        const postJob = await tx.postJob.create({
            data: {
                campaignTargetId: target.id,
                executeAt: new Date(),
                status: 'queued',
            },
        });

        return {
            advertiser,
            publisher,
            channel,
            campaign,
            creative,
            target,
            postJob,
        };
    });
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
