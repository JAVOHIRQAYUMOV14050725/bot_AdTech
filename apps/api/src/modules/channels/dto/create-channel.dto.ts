import { IsOptional, IsString } from 'class-validator';

export class CreateChannelDto {
    @IsString()
    telegramChannelId!: string;

    @IsString()
    title!: string;

    @IsOptional()
    @IsString()
    username?: string;
}