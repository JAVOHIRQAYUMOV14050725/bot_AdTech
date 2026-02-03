import { assertInviteTokenUsable } from '@/modules/auth/invite-token.util';

describe('invite token invariants', () => {
    it('rejects used tokens', () => {
        const now = new Date();
        expect(() =>
            assertInviteTokenUsable({
                usedAt: new Date(now.getTime() - 1000),
                expiresAt: new Date(now.getTime() + 60_000),
            }),
        ).toThrow('Invite token already used');
    });

    it('rejects expired tokens', () => {
        const now = new Date();
        expect(() =>
            assertInviteTokenUsable({
                usedAt: null,
                expiresAt: new Date(now.getTime() - 1000),
            }),
        ).toThrow('Invite token expired');
    });

    it('accepts active tokens', () => {
        const now = new Date();
        expect(() =>
            assertInviteTokenUsable({
                usedAt: null,
                expiresAt: new Date(now.getTime() + 60_000),
            }),
        ).not.toThrow();
    });
});