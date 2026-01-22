import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
    constructor(private readonly healthService: HealthService) { }

    @Get()
    health() {
        return this.healthService.live();
    }

    @Get('live')
    live() {
        return this.healthService.live();
    }

    @Get('ready')
    ready() {
        return this.healthService.ready();
    }
}
