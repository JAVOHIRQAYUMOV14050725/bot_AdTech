import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { HealthLiveResponseDto, HealthReadyResponseDto } from './dto/health-response.dto';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';

@Controller('health')
@ApiTags('Health')
export class HealthController {
    constructor(private readonly healthService: HealthService) { }

    @Get()
    @ApiOperation({
        summary: 'Health check',
        description: 'Basic liveness check.',
    })
    @ApiOkResponse({ type: HealthLiveResponseDto })
    @ApiStandardErrorResponses()
    health() {
        return this.healthService.live();
    }

    @Get('live')
    @ApiOperation({
        summary: 'Liveness check',
        description: 'Reports API availability.',
    })
    @ApiOkResponse({ type: HealthLiveResponseDto })
    @ApiStandardErrorResponses()
    live() {
        return this.healthService.live();
    }

    @Get('ready')
    @ApiOperation({
        summary: 'Readiness check',
        description: 'Reports dependencies readiness.',
    })
    @ApiOkResponse({ type: HealthReadyResponseDto })
    @ApiStandardErrorResponses()
    ready() {
        return this.healthService.ready();
    }
}