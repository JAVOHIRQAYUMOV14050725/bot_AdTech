import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateChannelDto {
    @IsString()
    @Matches(/^-100\d{5,}$/)
    telegramChannelId!: string;

    @IsString()
    title!: string;

    @IsOptional()
    @IsString()
    username?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d+(\.\d{1,2})?$/)
    cpm?: string;
}