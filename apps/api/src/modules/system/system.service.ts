import { PrismaService } from '@/prisma/prisma.service';
import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { EscrowService } from '@/modules/payments/escrow.service';
import { ResolveAction } from './dto/resolve-escrow.dto';
import Decimal from 'decimal.js';
@Injectable()
export class SystemService {
    private readonly logger = new Logger(SystemService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly escrowService: EscrowService,
    ) { }

    /**
     * =========================================================
     * 🔥 UNIVERSAL ESCROW RESOLVER (MANUAL OVERRIDE)
     * SUPER_ADMIN ONLY
     * =========================================================
     */
    async resolveEscrow(
        campaignTargetId: string,
        action: ResolveAction,
        reason: string,
        actorUserId: string,
    ) {
        const escrow = await this.prisma.escrow.findUnique({
            where: { campaignTargetId },
        });

        if (!escrow) {
            throw new BadRequestException('Escrow not found');
        }

        // 🧾 AUDIT (BEFORE)
        await this.prisma.userAuditLog.create({
            data: {
                userId: actorUserId,
                action: `ESCROW_${action.toUpperCase()}`,
                metadata: {
                    campaignTargetId,
                    reason,
                    escrowStatus: escrow.status,
                },
            },
        });

        let result;
        if (action === ResolveAction.RELEASE) {
            result = await this.escrowService.release(campaignTargetId);
        } else if (action === ResolveAction.REFUND) {
            result = await this.escrowService.refund(campaignTargetId, reason);
        } else {
            throw new BadRequestException('Invalid resolve action');
        }

        this.logger.warn(
            `[SYSTEM] Escrow ${action} executed for campaignTarget=${campaignTargetId}`,
        );

        return {
            ok: true,
            action,
            result,
        };
    }

    /**
     * =========================================================
     * ⏰ ESCROW WATCHDOG (AUTO REFUND)
     * =========================================================
     */
    async refundStuckEscrows() {
        const STUCK_HOURS = 6;

        const stuckEscrows = await this.prisma.escrow.findMany({
            where: {
                status: 'held',
                releasedAt: null,
                refundedAt: null,
                campaignTarget: {
                    postJob: {
                        OR: [
                            { status: 'failed' },
                            {
                                executeAt: {
                                    lt: new Date(
                                        Date.now() -
                                        STUCK_HOURS * 60 * 60 * 1000,
                                    ),
                                },
                            },
                        ],
                    },
                },
            },
            include: {
                campaignTarget: {
                    include: { postJob: true },
                },
            },
            take: 50,
        });

        for (const escrow of stuckEscrows) {
            try {
                this.logger.warn(
                    `[WATCHDOG] Refunding stuck escrow ${escrow.id}`,
                );

                await this.escrowService.refund(
                    escrow.campaignTargetId,
                    'watchdog_stuck_escrow',
                );

                await this.prisma.userAuditLog.create({
                    data: {
                        userId: 'SYSTEM',
                        action: 'ESCROW_WATCHDOG_REFUND',
                        metadata: {
                            escrowId: escrow.id,
                            campaignTargetId: escrow.campaignTargetId,
                        },
                    },
                });
            } catch (err) {
                this.logger.error(
                    `[WATCHDOG] Failed refund escrow ${escrow.id}`,
                    err instanceof Error ? err.stack : String(err),
                );
            }
        }

        return { checked: stuckEscrows.length };
    }

    /**
     * =========================================================
     * 🔐 LEDGER INVARIANT CHECK
     * balance(wallet) === sum(ledger entries)
     * =========================================================
     */
    async checkLedgerInvariant() {
        this.logger.warn('[INVARIANT] Ledger check started');

        const wallets = await this.prisma.wallet.findMany({
            select: { id: true, balance: true },
        });

        for (const wallet of wallets) {
            const agg = await this.prisma.ledgerEntry.aggregate({
                where: { walletId: wallet.id },
                _sum: { amount: true },
            });

            const ledgerSum = new Decimal(agg._sum.amount ?? 0);
            const balance = new Decimal(wallet.balance);

            if (!ledgerSum.equals(balance)) {
                this.logger.error(
                    `[LEDGER VIOLATION] wallet=${wallet.id} balance=${balance.toFixed(
                        2,
                    )} ledger=${ledgerSum.toFixed(2)}`,
                );

                // 🔥 PRODUCTION DECISION:
                // - crash
                // - alert
                // - page on-call
                throw new Error(
                    `Ledger invariant violated for wallet=${wallet.id}`,
                );
            }
        }

        this.logger.log('[INVARIANT] Ledger check passed');
    }
}
