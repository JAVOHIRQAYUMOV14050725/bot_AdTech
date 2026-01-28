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

    constructor(private readonly prisma: PrismaService,
        @Inject('LOGGER') private readonly logger: LoggerService
    ) { }

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
        this.logger.warn({
            event: 'kill_switch_seeded_defaults',
            keys,
        },
            'KillSwitchService');
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