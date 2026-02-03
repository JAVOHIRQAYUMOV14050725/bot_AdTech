import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsBoolean,
    IsEnum,
    IsIn,
    IsNotEmpty,
    IsOptional,
} from 'class-validator';
import { UserRole } from '@/modules/domain/contracts';
export const PUBLIC_ROLES = [
    UserRole.publisher,
] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export class RegisterDto {
    @ApiProperty({
        example: true,
        description:
            'Invite-only registration. Set to true to create a pending publisher invite. Users must start the Telegram bot to complete registration.',
    })
    @IsBoolean()
    @IsNotEmpty()
    invite!: boolean;

    @ApiPropertyOptional({
        enum: PUBLIC_ROLES,
        description: 'Role for registration (publisher only).',
        example: UserRole.publisher,
        default: UserRole.publisher,
    })
    @IsOptional()
    @IsEnum(UserRole)
    @IsIn(PUBLIC_ROLES)
    role?: PublicRole;
}
