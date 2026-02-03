import { IsString } from 'class-validator';

export class InternalTelegramAdminPostDto {
    @IsString()
    telegramId!: string;

    @IsString()
    postJobId!: string;
}