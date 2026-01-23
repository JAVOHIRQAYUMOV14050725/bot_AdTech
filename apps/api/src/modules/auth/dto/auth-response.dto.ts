import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

export class AuthUserDto {
    @ApiProperty({ example: '4c56e3b8-7d2b-4db8-9b03-2d8b8f4b9f6c' })
    id!: string;

    @ApiProperty({ example: '1234567890' })
    telegramId!: string;

    @ApiProperty({ enum: UserRole, example: UserRole.advertiser })
    role!: UserRole;

    @ApiPropertyOptional({ example: 'channel_handle' })
    username?: string | null;
}

export class AuthResponseDto {
    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    accessToken!: string;

    @ApiProperty({ type: AuthUserDto })
    user!: AuthUserDto;
}

export class MeResponseDto extends AuthUserDto {
    @ApiProperty({ enum: UserStatus, example: UserStatus.active })
    status!: UserStatus;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt!: Date;
}
