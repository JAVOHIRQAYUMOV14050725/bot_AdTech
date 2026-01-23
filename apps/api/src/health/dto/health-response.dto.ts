import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthLiveResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    timestamp!: string;
}

export class HealthCheckResultDto {
    @ApiProperty({ example: 'ok' })
    status!: string;

    @ApiPropertyOptional({ type: 'object', additionalProperties: true })
    details?: Record<string, unknown>;
}

export class HealthReadyResponseDto extends HealthLiveResponseDto {
    @ApiProperty({
        type: 'object',
        additionalProperties: { type: HealthCheckResultDto },
    })
    checks!: Record<string, HealthCheckResultDto>;
}
