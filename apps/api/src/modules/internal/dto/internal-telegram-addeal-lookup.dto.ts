import { IsString } from 'class-validator';

export class InternalTelegramAddealLookupDto {
    @IsString()
    adDealId!: string;
}