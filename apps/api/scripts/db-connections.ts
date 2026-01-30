import 'dotenv/config';

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const rows = await prisma.$queryRaw<
        { state: string | null; count: number }[]
    >(Prisma.sql`
        SELECT state, COUNT(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state
    `);

    const total = rows.reduce((sum, row) => sum + row.count, 0);

    console.log(
        JSON.stringify(
            {
                total,
                byState: rows.map((row) => ({
                    state: row.state ?? 'unknown',
                    count: row.count,
                })),
                generatedAt: new Date().toISOString(),
            },
            null,
            2,
        ),
    );
}

main()
    .catch((error) => {
        console.error('[db-connections] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });