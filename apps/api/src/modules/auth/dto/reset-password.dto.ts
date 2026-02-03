import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class ResetPasswordDto {
    @ApiProperty({ example: '@username', description: 'Telegram @username or t.me link.' })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    identifier!: string;

    @ApiProperty({ example: 'NewS3cureP@ssw0rd' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    newPassword!: string;
}