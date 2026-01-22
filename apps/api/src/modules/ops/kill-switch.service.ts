import { PrismaService } from '@/prisma/prisma.service';
import { KillSwitchKey } from '@prisma/client';
import {
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class KillSwitchService {
    private readonly logger = new Logger(KillSwitchService.name);

    constructor(private readonly prisma: PrismaService) { }

    async isEnabled(key: KillSwitchKey): Promise<boolean> {
        try {
            const record = await this.prisma.killSwitch.findUnique({
                where: { key },
                select: { enabled: true },
            });

            if (!record) {
                this.logger.error(
                    `[KILL_SWITCH] Missing config for ${key} (default=blocked)`,
                );
                return false;
            }

            return record.enabled;
        } catch (err) {
            this.logger.error(
                `[KILL_SWITCH] Failed lookup for ${key} (default=blocked)`,
                err instanceof Error ? err.stack : String(err),
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
            this.logger.error(
                JSON.stringify({
                    event: 'kill_switch_blocked',
                    key: params.key,
                    reason: params.reason,
                    correlationId: params.correlationId ?? null,
                }),
            );
            throw new ServiceUnavailableException(
                `Operation blocked by kill switch: ${params.key}`,
            );
        }
    }
}
