import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class InternalTelegramResolvePublisherDto {
    @ApiProperty({ example: '@publisher' })
    @IsString()
    identifier!: string;
}