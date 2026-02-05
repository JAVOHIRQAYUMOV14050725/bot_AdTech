import { IsString } from 'class-validator';
import { IsTelegramIdString } from '@/common/validators/telegram-id-string.decorator';

export class InternalTelegramEnsureDto {
    @IsString()
    @IsTelegramIdString()
    telegramId!: string;
}
