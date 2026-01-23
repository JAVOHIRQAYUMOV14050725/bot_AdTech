import { PrismaClient, KillSwitchKey, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const parseTelegramId = (value: string): bigint => {
    if (!value.startsWith('-100') && !/^\d+$/.test(value)) {
        throw new Error('Invalid SUPER_ADMIN_TELEGRAM_ID format');
    }
    return BigInt(value);
};

async function seedKillSwitches() {
    const keys = Object.values(KillSwitchKey);
    await Promise.all(
        keys.map((key) =>
            prisma.killSwitch.upsert({
                where: { key },
                update: {},
                create: {
                    key,
                    enabled: true,
                    reason: 'seeded_default',
                    updatedBy: 'SEED',
                },
            }),
        ),
    );
}

async function seedSuperAdmin() {
    const telegramIdRaw = process.env.SUPER_ADMIN_TELEGRAM_ID;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const username = process.env.SUPER_ADMIN_USERNAME;

    if (!telegramIdRaw || !password) {
        return;
    }

    const telegramId = parseTelegramId(telegramIdRaw);
    const existing = await prisma.user.findUnique({
        where: { telegramId },
    });

    if (existing) {
        return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            telegramId,
            username: username ?? 'super_admin',
            role: UserRole.super_admin,
            status: UserStatus.active,
            passwordHash,
        },
    });

    await prisma.wallet.create({
        data: {
            userId: user.id,
            balance: 0,
            currency: 'USD',
        },
    });
}

async function main() {
    await seedKillSwitches();
    await seedSuperAdmin();
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (error) => {
        console.error(error);
        await prisma.$disconnect();
        process.exit(1);
    });
