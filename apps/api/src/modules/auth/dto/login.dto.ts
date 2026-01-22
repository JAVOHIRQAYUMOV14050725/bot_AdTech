import { IsString, MinLength } from 'class-validator';

export class LoginDto {
    @IsString()
    telegramId!: string;

    @IsString()
    @MinLength(8)
    password!: string;
}