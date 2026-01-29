import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KillSwitchService } from './kill-switch.service';

@Injectable()
export class KillSwitchSeeder implements OnModuleInit {
    private readonly logger = new Logger(KillSwitchSeeder.name);
    constructor(private readonly killSwitchService: KillSwitchService) { }

    async onModuleInit() {
        try {
            await this.killSwitchService.seedDefaults();
        } catch (error) {
            const err = error as { code?: string; message?: string };
            const message = err?.message ?? String(error);
            if (err?.code === 'P2021') {
                this.logger.error(
                    `Kill switch seed skipped: missing table. ${message}`,
                );
                return;
            }
            this.logger.error(`Kill switch seed failed: ${message}`);
            throw error;
        }
    }
}
