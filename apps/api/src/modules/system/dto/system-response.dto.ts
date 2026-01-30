import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KillSwitchKey } from '@prisma/client';
import { ResolveAction } from './resolve-escrow.dto';
import { ReconciliationMode } from './reconciliation.dto';

export class ResolveEscrowResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ enum: ResolveAction })
    action!: ResolveAction;

    @ApiProperty({ type: 'object', additionalProperties: true })
    result!: Record<string, unknown>;
}

export class KillSwitchResponseDto {
    @ApiProperty({ enum: KillSwitchKey })
    key!: KillSwitchKey;

    @ApiProperty({ example: true })
    enabled!: boolean;

    @ApiPropertyOptional({ example: 'Maintenance window.' })
    reason?: string | null;

    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    updatedBy!: string;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt!: Date;

    @ApiProperty({ example: '2024-01-02T00:00:00.000Z' })
    updatedAt!: Date;
}

export class ReconciliationResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ enum: ReconciliationMode })
    mode!: ReconciliationMode;

    @ApiProperty({ example: 'recon:1700000000000' })
    correlationId!: string;

    @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
    discrepancies!: Array<Record<string, unknown>>;

    @ApiProperty({ example: true })
    readOnly!: boolean;
}

export class DbConnectionsResponseDto {
    @ApiProperty({ example: 12 })
    total!: number;

    @ApiProperty({
        example: [{ state: 'active', count: 2 }, { state: 'idle', count: 10 }],
    })
    byState!: Array<{ state: string; count: number }>;

    @ApiProperty({ example: '2024-01-02T00:00:00.000Z' })
    generatedAt!: string;
}
