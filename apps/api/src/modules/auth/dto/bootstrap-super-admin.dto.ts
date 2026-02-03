import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class BootstrapSuperAdminDto {
    @ApiProperty({
        example: '@username',
        description:
            'Telegram @username or t.me link. The user must have started the Telegram bot with /start first.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    identifier!: string;

    @ApiProperty({ example: 'superadmin' })
    @IsString()
    @IsNotEmpty()
    username!: string;

    @ApiProperty({ example: 'S3cureP@ssw0rd' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    password!: string;

    @ApiProperty({ example: 'bootstrap-secret' })
    @IsString()
    @IsNotEmpty()
    bootstrapSecret!: string;
}