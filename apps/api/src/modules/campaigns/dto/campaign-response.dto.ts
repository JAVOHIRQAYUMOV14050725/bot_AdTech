import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, CampaignTargetStatus, CreativeType } from '@prisma/client';

export class CampaignResponseDto {
    @ApiProperty({ example: '2c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    id!: string;

    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    advertiserId!: string;

    @ApiProperty({ example: 'Spring Campaign' })
    name!: string;

    @ApiProperty({ example: '1500.00' })
    totalBudget!: string;

    @ApiProperty({ example: '0.00' })
    spentBudget!: string;

    @ApiProperty({ enum: CampaignStatus })
    status!: CampaignStatus;

    @ApiPropertyOptional({ example: null })
    startAt?: Date | null;

    @ApiPropertyOptional({ example: null })
    endAt?: Date | null;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt!: Date;
}

export class CreativeResponseDto {
    @ApiProperty({ example: 'f1a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    id!: string;

    @ApiProperty({ example: '2c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    campaignId!: string;

    @ApiProperty({ enum: CreativeType })
    contentType!: CreativeType;

    @ApiProperty({ type: 'object', additionalProperties: true })
    contentPayload!: Record<string, unknown>;

    @ApiPropertyOptional({ example: null })
    approvedBy?: string | null;

    @ApiPropertyOptional({ example: null })
    approvedAt?: Date | null;
}

export class TargetResponseDto {
    @ApiProperty({ example: 'a9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    id!: string;

    @ApiProperty({ example: '2c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    campaignId!: string;

    @ApiProperty({ example: 'b7a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    channelId!: string;

    @ApiProperty({ example: '250.00' })
    price!: string;

    @ApiProperty({ example: '2024-02-01T12:00:00.000Z' })
    scheduledAt!: Date;

    @ApiProperty({ enum: CampaignTargetStatus })
    status!: CampaignTargetStatus;

    @ApiPropertyOptional({ example: null })
    moderatedBy?: string | null;

    @ApiPropertyOptional({ example: null })
    moderatedAt?: Date | null;

    @ApiPropertyOptional({ example: null })
    moderationReason?: string | null;
}

export class TargetSubmitResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ example: 'a9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    targetId!: string;
}
