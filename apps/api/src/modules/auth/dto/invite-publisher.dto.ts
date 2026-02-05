import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export class InvitePublisherDto {
    @ApiProperty({
        example: 'publisher_handle',
        description: 'Telegram @username to bind the invite to a specific Telegram account.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    username!: string;
}
