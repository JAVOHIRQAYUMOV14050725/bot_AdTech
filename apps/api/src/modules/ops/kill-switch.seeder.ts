import { Injectable, OnModuleInit } from '@nestjs/common';
import { KillSwitchService } from './kill-switch.service';

@Injectable()
export class KillSwitchSeeder implements OnModuleInit {
    constructor(private readonly killSwitchService: KillSwitchService) {}

    async onModuleInit() {
        await this.killSwitchService.seedDefaults();
    }
}
