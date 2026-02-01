import { KillSwitchKey } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
    Inject,
    Injectable,
    Logger,
    LoggerService,
    ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class KillSwitchService {
    async seedDefaults() {
        const keys = Object.values(KillSwitchKey);

        await Promise.all(
            keys.map((key) =>
                this.prisma.killSwitch.upsert({
                    where: { key },
                    update: {},
                    create: {
                        key,
                        enabled: true,
                        reason: 'seeded_default',
                        updatedBy: 'SYSTEM',
                    },
                }),
            ),
        );

        this.logger.warn(
            {
                event: 'kill_switch_seeded_defaults',
                keys,
            },
            'KillSwitchService',
        );
    }


    constructor(private readonly prisma: PrismaService,
        @Inject('LOGGER') private readonly logger: LoggerService
    ) { }

    async setEnabled(params: {
        key: KillSwitchKey;
        enabled: boolean;
        actor: string;
        reason: string;
        metadata?: Record<string, any>;
    }) {
        const { key, enabled, actor, reason, metadata } = params;

        return this.prisma.$transaction(async (tx) => {
            const current = await tx.killSwitch.findUnique({
                where: { key },
            });

            if (!current) {
                throw new ServiceUnavailableException(
                    `Kill switch ${key} not found`,
                );
            }

            if (current.enabled === enabled) {
                return { ok: true, noop: true };
            }

            await tx.killSwitch.update({
                where: { key },
                data: {
                    enabled,
                    reason,
                    updatedBy: actor,
                },
            });

            await tx.killSwitchEvent.create({
                data: {
                    key,
                    previousEnabled: current.enabled,
                    newEnabled: enabled,
                    actor,
                    reason,
                    metadata,
                },
            });

            this.logger.warn(
                {
                    event: 'kill_switch_toggled',
                    key,
                    from: current.enabled,
                    to: enabled,
                    actor,
                    reason,
                },
                'KillSwitchService',
            );

            return { ok: true };
        });
    }


    async isEnabled(key: KillSwitchKey): Promise<boolean> {
        try {
            const record = await this.prisma.killSwitch.findUnique({
                where: { key },
                select: { enabled: true },
            });

            if (!record) {
                this.logger.error({
                    event: 'kill_switch_missing_record',
                    key,

                },
                    'KillSwitchService'
                );
                return false;
            }

            return record.enabled;
        } catch (err) {
            this.logger.error({
                event: 'kill_switch_check_failed',
                key,
                error: err instanceof Error ? err.message : String(err),
            },
                'KillSwitchService'  
            );
            return false;
        }
    }

    async assertEnabled(params: {
        key: KillSwitchKey;
        reason: string;
        correlationId?: string;
    }) {
        const enabled = await this.isEnabled(params.key);
        if (!enabled) {
            this.logger.error({
                event: 'kill_switch_blocked_operation',
                key: params.key,
                reason: params.reason,
                correlationId: params.correlationId ?? null,
            },
                'KillSwitchService'
            );
            throw new ServiceUnavailableException(
                `Operation blocked by kill switch: ${params.key}`,
            );
        }
    }
}