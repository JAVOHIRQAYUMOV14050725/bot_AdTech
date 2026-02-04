import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@/modules/domain/contracts';

export class ChangeRoleDto {
    @ApiProperty({ example: 'user-id' })
    @IsString()
    @IsNotEmpty()
    userId!: string;

    @ApiProperty({ enum: UserRole })
    @IsEnum(UserRole)
    role!: UserRole;

    @ApiPropertyOptional({ example: 'Promotion to admin' })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    reason?: string;
}