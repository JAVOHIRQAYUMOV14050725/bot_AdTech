import { IsString } from 'class-validator';

export class InternalTelegramEnsureDto {
    @IsString()
    telegramId!: string;
}
