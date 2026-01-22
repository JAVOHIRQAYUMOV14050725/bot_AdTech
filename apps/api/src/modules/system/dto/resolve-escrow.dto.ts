import { IsEnum, IsString } from 'class-validator';

export enum ResolveAction {
    RELEASE = 'release',
    REFUND = 'refund',
}

export class ResolveEscrowDto {
    @IsString()
    campaignTargetId: string;

    @IsEnum(ResolveAction)
    action: ResolveAction;

    @IsString()
    reason: string;
}
