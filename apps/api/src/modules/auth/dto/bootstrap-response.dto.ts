import { ApiProperty } from '@nestjs/swagger';

export class BootstrapResponseDto {
    @ApiProperty({
        example: {
            id: 'user-id',
            telegramId: null,
            role: 'super_admin',
            roles: ['super_admin'],
            username: 'superadmin',
        },
    })
    user!: {
        id: string;
        telegramId: string | null;
        role: string;
        roles: string[];
        username: string | null;
    };

    @ApiProperty({
        example: 'https://t.me/adtech_bot?start=BOOTSTRAP',
        description: 'Telegram deep link to link the super admin to the bot.',
    })
    deepLink!: string;
}