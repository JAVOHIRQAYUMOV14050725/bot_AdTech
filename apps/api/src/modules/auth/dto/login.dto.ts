import { ApiProperty } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class LoginDto {
    @ApiProperty({
        example: '@username or superadmin',
        description:
            'Telegram @username or t.me link. Super admins can also login with their username without Telegram.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    identifier!: string;

    @ApiProperty({
        example: 'StrongPassw0rd!',
        minLength: 8,
        maxLength: 128,
    })
    @TrimString()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @IsNotEmpty()
    password!: string;
}
