import { Injectable, Inject, LoggerService } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/modules/redis/redis.service';
import { CronStatusService } from '@/modules/scheduler/cron-status.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { JwtService } from '@nestjs/jwt';
import { postQueue } from '@/modules/scheduler/queues';
import { RedisConfig, redisConfig } from '@/config/redis.config';
import { TelegramConfig, telegramConfig } from '@/config/telegram.config';
import { JwtConfig, jwtConfig } from '@/config/jwt.config';
import { ConfigType } from '@nestjs/config';

type CheckStatus = 'ok' | 'failed' | 'disabled';

interface CheckResult {
    status: CheckStatus;
    details?: Record<string, unknown>;
}
@Injectable()
export class HealthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly cronStatusService: CronStatusService,
        private readonly telegramService: TelegramService,
        private readonly jwtService: JwtService,
        @Inject('LOGGER') private readonly logger: LoggerService,

        @Inject(redisConfig.KEY)
        private readonly redisConfig: RedisConfig,

        @Inject(telegramConfig.KEY)
        private readonly telegramConfig: TelegramConfig,

        @Inject(jwtConfig.KEY)
        private readonly jwtConfig: JwtConfig,
    ) { }


    async live() {
        return {
            ok: true,
            timestamp: new Date().toISOString(),
        };
    }

    async ready() {
        const checks: Record<string, CheckResult> = {};

        checks.db = await this.checkDatabase(this.prisma);
        checks.migrations = await this.checkMigrations(this.prisma);
        checks.redis = await this.checkRedis();
        checks.bullmq = await this.checkBullmq();
        checks.worker = await this.checkWorkerHeartbeat();
        checks.telegram = await this.checkTelegram();
        checks.auth = await this.checkAuth();
        checks.cron = await this.checkCron();

        const ok = Object.values(checks).every((check) =>
            check.status === 'ok' || check.status === 'disabled',
        );

        return {
            ok,
            timestamp: new Date().toISOString(),
            checks,
        };
    }

    private async checkDatabase(prisma: PrismaClient): Promise<CheckResult> {
        try {
            await prisma.$queryRaw(Prisma.sql`SELECT 1`);
            return { status: 'ok' };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkMigrations(prisma: PrismaClient): Promise<CheckResult> {
        try {
            const result = await prisma.$queryRaw<{ exists: boolean }[]>(
                Prisma.sql`
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                          AND table_name = 'kill_switches'
                    ) as "exists";
                `,
            );
            const exists = result?.[0]?.exists ?? false;
            if (!exists) {
                return {
                    status: 'failed',
                    details: { error: 'kill_switches table missing' },
                };
            }

            const columns = await prisma.$queryRaw<{ column_name: string }[]>(
                Prisma.sql`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'post_jobs';
                `,
            );
            const columnSet = new Set(columns.map((row) => row.column_name));
            const requiredColumns = [
                'sendingAt',
                'lastAttemptAt',
                'telegramMessageId',
            ];
            const missingColumns = requiredColumns.filter(
                (column) => !columnSet.has(column),
            );

            if (missingColumns.length > 0) {
                return {
                    status: 'failed',
                    details: {
                        error: 'post_jobs schema mismatch',
                        missingColumns,
                    },
                };
            }

            return { status: 'ok' };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkRedis(): Promise<CheckResult> {
        try {
            const client = this.redisService.getClient();
            const pong = await client.ping();
            const authConfigured = Boolean(this.redisConfig.password);
            const authPresent = Boolean(client.options.password);
            const authOk = !authConfigured || authPresent;

            if (!authOk) {
                return {
                    status: 'failed',
                    details: {
                        error: 'REDIS_PASSWORD configured but client missing password',
                    },
                };
            }

            return {
                status: pong === 'PONG' ? 'ok' : 'failed',
                details: { pong, authConfigured },
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkBullmq(): Promise<CheckResult> {
        try {
            await postQueue.waitUntilReady();
            const counts = await postQueue.getJobCounts(
                'wait',
                'delayed',
                'active',
                'failed',
            );
            this.logger.log(
                {
                    event: 'queue_backlog_snapshot',
                    data: {
                        queue: postQueue.name,
                        counts,
                    },
                },
                'HealthService',
            );
            return {
                status: 'ok',
                details: counts,
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkWorkerHeartbeat(): Promise<CheckResult> {
        try {
            const client = this.redisService.getClient();
            const value = await client.get('worker:heartbeat');
            if (!value) {
                return {
                    status: 'failed',
                    details: { error: 'heartbeat_missing' },
                };
            }

            const last = new Date(value);
            const ageSeconds = Math.floor((Date.now() - last.getTime()) / 1000);
            const stale = ageSeconds > 30;

            return {
                status: stale ? 'failed' : 'ok',
                details: {
                    lastHeartbeatAt: last.toISOString(),
                    ageSeconds,
                },
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkTelegram(): Promise<CheckResult> {
        const autostart = this.telegramConfig.autostart;
        if (!autostart) {
            return { status: 'disabled' };
        }

        try {
            const botInfo = await this.telegramService.checkConnection();
            return {
                status: 'ok',
                details: {
                    botId: botInfo.id,
                    username: botInfo.username ?? null,
                },
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkAuth(): Promise<CheckResult> {
        try {
            const token = await this.jwtService.signAsync({
                sub: 'health-check',
                scope: 'ready',
            }, {
                secret: this.jwtConfig.access.secret,
                issuer: this.jwtConfig.issuer,
                audience: this.jwtConfig.audience,
            });
            await this.jwtService.verifyAsync(token, {
                secret: this.jwtConfig.access.secret,
                issuer: this.jwtConfig.issuer,
                audience: this.jwtConfig.audience,
            });
            return {
                status: 'ok',
                details: { signed: true },
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    private async checkCron(): Promise<CheckResult> {
        try {
            const escrow = await this.cronStatusService.getStatus(
                'escrow_watchdog',
            );
            const ledger = await this.cronStatusService.getStatus(
                'ledger_invariant',
            );

            if (!escrow || !ledger) {
                return {
                    status: 'failed',
                    details: {
                        error: 'missing_cron_status',
                        escrow,
                        ledger,
                    },
                };
            }

            if (escrow.lastResult === 'failed' || ledger.lastResult === 'failed') {
                return {
                    status: 'failed',
                    details: {
                        error: 'cron_failed',
                        escrowWatchdog: escrow,
                        ledgerInvariant: ledger,
                    },
                };
            }

            return {
                status: 'ok',
                details: {
                    escrowWatchdog: escrow,
                    ledgerInvariant: ledger,
                },
            };
        } catch (err) {
            return {
                status: 'failed',
                details: {
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }
}
