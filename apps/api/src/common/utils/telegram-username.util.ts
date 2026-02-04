export function normalizeTelegramUsername(input?: string | null): string | null {
    if (input == null) {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    const linkMatch = trimmed.match(/^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i);
    const candidate = linkMatch ? linkMatch[1] : trimmed;

    const withoutAt = candidate.replace(/^@+/, '').trim();
    if (!withoutAt) {
        return null;
    }

    return withoutAt.toLowerCase();
}