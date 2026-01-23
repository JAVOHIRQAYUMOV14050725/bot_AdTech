import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    CampaignStatus,
    CampaignTargetStatus,
    ChannelStatus,
    CreativeType,
    PostJobStatus,
} from '@prisma/client';

export class ModerationChannelDto {
    @ApiProperty({ example: 'b7a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    id!: string;

    @ApiProperty({ example: '-1001234567890' })
    telegramChannelId!: string;

    @ApiProperty({ example: 'My Channel' })
    title!: string;

    @ApiPropertyOptional({ example: 'channel_handle' })
    username?: string | null;

    @ApiPropertyOptional({ example: 'marketing' })
    category?: string | null;

    @ApiProperty({ example: 12000 })
    subscriberCount!: number;

    @ApiProperty({ example: 8000 })
    avgViews!: number;

    @ApiProperty({ example: '12.50' })
    cpm!: string;

    @ApiProperty({ enum: ChannelStatus })
    status!: ChannelStatus;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt!: Date;

    @ApiPropertyOptional({ example: null })
    deletedAt?: Date | null;

    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    ownerId!: string;
}

export class ModerationCreativeDto {
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

export class ModerationCampaignDto {
    @ApiProperty({ example: '2c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    id!: string;

    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    advertiserId!: string;

    @ApiProperty({ example: 'Spring Launch' })
    name!: string;

    @ApiProperty({ example: '1000.00' })
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

    @ApiPropertyOptional({ type: [ModerationCreativeDto] })
    creatives?: ModerationCreativeDto[];
}

export class ModerationPostJobDto {
    @ApiProperty({ example: 'c9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    id!: string;

    @ApiProperty({ example: 'a9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    campaignTargetId!: string;

    @ApiProperty({ example: '2024-02-01T12:00:00.000Z' })
    executeAt!: Date;

    @ApiProperty({ example: 0 })
    attempts!: number;

    @ApiProperty({ enum: PostJobStatus })
    status!: PostJobStatus;

    @ApiPropertyOptional({ example: null })
    lastError?: string | null;
}

export class ModerationTargetDto {
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

    @ApiPropertyOptional({ type: ModerationCampaignDto })
    campaign?: ModerationCampaignDto;

    @ApiPropertyOptional({ type: ModerationChannelDto })
    channel?: ModerationChannelDto;

    @ApiPropertyOptional({ type: ModerationPostJobDto })
    postJob?: ModerationPostJobDto | null;
}

export class ModerationApproveResponseDto {
    @ApiProperty({ example: true })
    ok!: boolean;

    @ApiProperty({ example: 'a9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    targetId!: string;

    @ApiPropertyOptional({ example: 'c9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    postJobId?: string;

    @ApiPropertyOptional({ example: true })
    alreadyApproved?: boolean;
}
