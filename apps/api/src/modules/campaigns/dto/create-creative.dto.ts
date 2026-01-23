import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject } from 'class-validator';
import { CreativeType } from '@prisma/client';

export class CreateCreativeDto {
    @ApiProperty({ enum: CreativeType, example: CreativeType.text })
    @IsEnum(CreativeType)
    contentType!: CreativeType;

    @ApiProperty({
        type: 'object',
        additionalProperties: true,
        example: { text: 'Buy now!' },
    })
    @IsObject()
    @IsNotEmpty()
    contentPayload!: Record<string, unknown>;
}
