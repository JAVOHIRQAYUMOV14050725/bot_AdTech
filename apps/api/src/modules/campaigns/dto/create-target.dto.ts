import { IsDateString, IsString } from 'class-validator';

export class CreateTargetDto {
    @IsString()
    channelId!: string;

    @IsString()
    price!: string;

    @IsDateString()
    scheduledAt!: string;
}
