import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelStatus } from '@prisma/client';

export class ChannelResponseDto {
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

    @ApiProperty({ enum: ChannelStatus, example: ChannelStatus.pending })
    status!: ChannelStatus;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt!: Date;

    @ApiPropertyOptional({ example: null, nullable: true })
    deletedAt?: Date | null;

    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    ownerId!: string;
}
