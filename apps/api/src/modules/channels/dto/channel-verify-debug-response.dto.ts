import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChannelVerifyDebugResponseDto {
    @ApiProperty({ example: 'b7a395a5-2ad8-4c1a-a58b-7d0d529e2f3c' })
    channelId!: string;

    @ApiProperty({ example: '-1001987654321' })
    telegramChannelId!: string;

    @ApiProperty({ example: true })
    canAccessChat!: boolean;

    @ApiProperty({ example: true })
    isAdmin!: boolean;

    @ApiProperty({ example: 'UNKNOWN' })
    reason!: string;

    @ApiPropertyOptional({ example: 'Bad Request: chat not found' })
    telegramError?: string;

    @ApiPropertyOptional({ example: 30, nullable: true })
    retryAfterSeconds?: number | null;
}