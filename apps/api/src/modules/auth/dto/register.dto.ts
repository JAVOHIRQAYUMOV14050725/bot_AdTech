import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export const PUBLIC_ROLES = [
    UserRole.advertiser,
    UserRole.publisher,
] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export class RegisterDto {
    @IsString()
    telegramId!: string;

    @IsString()
    @MinLength(8)
    password!: string;

    @IsEnum(UserRole)
    @IsIn(PUBLIC_ROLES)
    role!: PublicRole;

    @IsOptional()
    @IsString()
    username?: string;
}