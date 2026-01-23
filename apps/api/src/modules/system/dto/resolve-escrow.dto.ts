import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TrimString } from '@/common/transformers/trim-string.transformer';

export enum ResolveAction {
    RELEASE = 'release',
    REFUND = 'refund',
}

export class ResolveEscrowDto {
    @ApiProperty({
        example: 'a9a395a5-2ad8-4c1a-a58b-7d0d529e2f3c',
        description: 'Campaign target UUID tied to escrow.',
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @IsUUID()
    campaignTargetId!: string;

    @ApiProperty({ enum: ResolveAction, example: ResolveAction.RELEASE })
    @IsEnum(ResolveAction)
    action!: ResolveAction;

    @ApiProperty({
        example: 'Manual resolve due to payout issue.',
        minLength: 3,
        maxLength: 500,
    })
    @TrimString()
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(500)
    reason!: string;
}