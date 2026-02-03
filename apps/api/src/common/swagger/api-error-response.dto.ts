import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiValidationErrorDetailDto {
    @ApiProperty({ example: 'identifier' })
    field!: string;

    @ApiProperty({
        example: { isNotEmpty: 'identifier should not be empty' },
    })
    constraints!: Record<string, string>;

    @ApiPropertyOptional({ example: '@example' })
    value?: unknown;
}

export class ApiErrorDetailsDto {
    @ApiProperty({ example: 'Validation failed' })
    message!: string;

    @ApiPropertyOptional({
        type: [ApiValidationErrorDetailDto],
    })
    details?: ApiValidationErrorDetailDto[];
}

export class ApiErrorResponseDto {
    @ApiProperty({ example: 400 })
    statusCode!: number;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    timestamp!: string;

    @ApiProperty({ example: '/api/auth/register' })
    path!: string;

    @ApiPropertyOptional({ example: 'c0a8012e-4c5b-4c4f-8f3d-1234567890ab' })
    correlationId!: string | null;

    @ApiProperty({ type: ApiErrorDetailsDto })
    error!: ApiErrorDetailsDto;
}
