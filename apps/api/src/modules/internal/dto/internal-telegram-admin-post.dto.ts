import { IsString } from 'class-validator';
import { IsTelegramIdString } from '@/common/validators/telegram-id-string.decorator';

export class InternalTelegramAdminPostDto {
    @IsString()
    @IsTelegramIdString()
    telegramId!: string;

    @IsString()
    postJobId!: string;
}