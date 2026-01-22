import { IsEnum, IsObject } from 'class-validator';
import { CreativeType } from '@prisma/client';

export class CreateCreativeDto {
    @IsEnum(CreativeType)
    contentType!: CreativeType;

    @IsObject()
    contentPayload!: Record<string, unknown>;
}
