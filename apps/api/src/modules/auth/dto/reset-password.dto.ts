import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @ApiProperty({ example: '123456789' })
    @IsString()
    @IsNotEmpty()
    telegramId!: string;

    @ApiProperty({ example: 'NewS3cureP@ssw0rd' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    newPassword!: string;
}