import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class BootstrapSuperAdminDto {
    @ApiProperty({ example: '123456789' })
    @IsString()
    @IsNotEmpty()
    telegramId!: string;

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