import { ChannelStatus } from "./channel.types";

// domain/channel/channel.policy.ts
export class ChannelPolicy {
    static canBeSubmitted(status?: ChannelStatus) {
        return !status || status === ChannelStatus.REJECTED;
    }
}
