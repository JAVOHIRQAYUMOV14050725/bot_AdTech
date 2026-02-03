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
}
