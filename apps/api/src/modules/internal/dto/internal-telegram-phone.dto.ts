import { IsString, IsNotEmpty } from 'class-validator';

export class InternalTelegramPhoneDto {
    @IsString()
    @IsNotEmpty()
    userId!: string;

    @IsString()
    @IsNotEmpty()
    phoneNumber!: string;
}