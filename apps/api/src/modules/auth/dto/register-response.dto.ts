import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@/modules/domain/contracts';
export class RegisterResponseDto {
    @ApiProperty({
        example: {
            id: 'invite-id',
            intendedRole: UserRole.publisher,
            intendedUsernameNormalized: 'publisher_handle',
            expiresAt: '2024-01-01T00:00:00.000Z',
        },
    })
    invite!: {
        id: string;
        intendedRole: UserRole;
        intendedUsernameNormalized?: string | null;
        expiresAt: Date;
    };

    @ApiProperty({
        example: 'invite-token',
        description: 'Single-use invite token for publisher onboarding.',
    })
    inviteToken!: string;

    @ApiProperty({
        example: 'https://t.me/adtech_bot?start=invite-token',
        description: 'Telegram deep link to start the bot with the invite token.',
    })
    deepLink!: string;
}