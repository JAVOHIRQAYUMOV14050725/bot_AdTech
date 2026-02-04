import { ApiProperty } from '@nestjs/swagger';
import { AuthUserDto } from './auth-response.dto';

export class RegisterResponseDto {
    @ApiProperty({ type: AuthUserDto })
    user!: AuthUserDto;

    @ApiProperty({
        example: 'invite-token',
        description: 'Single-use invite token for publisher onboarding.',
    })
    inviteToken!: string;

    @ApiProperty({
        example: 'https://t.me/your_bot?start=invite-token',
        description: 'Telegram deep link to start the bot with the invite token.',
    })
    deepLink!: string;
}
