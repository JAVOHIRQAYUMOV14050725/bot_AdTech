import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class RegisterDto {
    @IsString()
    telegramId!: string;

    @IsString()
    @MinLength(8)
    password!: string;

    @IsEnum(UserRole)
    role!: UserRole;

    @IsOptional()
    @IsString()
    username?: string;
}