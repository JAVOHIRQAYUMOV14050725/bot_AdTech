export function normalizeTelegramUsername(input?: string | null): string | null {
    if (input == null) {
        return null;
    }

    const trimmed = input.trim().replace(/\s+/g, ' ');
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

export function parseTelegramIdentifier(input?: string | null): {
    normalized: string | null;
    source: 'link' | 'username' | null;
} {
    if (input == null) {
        return { normalized: null, source: null };
    }

    const trimmed = input.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
        return { normalized: null, source: null };
    }

    const linkMatch = trimmed.match(/^(?:https?:\/\/)?t\.me\/([^?\s/]+)(?:\/.*)?$/i);
    const candidate = linkMatch ? linkMatch[1] : trimmed;
    const source = linkMatch ? 'link' : 'username';
    const normalized = normalizeTelegramUsername(candidate);

    return { normalized, source: normalized ? source : null };
}

export function normalizeTelegramIdentifierInput(input?: string | null): {
    canonical: string | null;
    username: string | null;
    source: 'link' | 'username' | null;
} {
    const parsed = parseTelegramIdentifier(input ?? null);
    if (!parsed.normalized) {
        return { canonical: null, username: null, source: null };
    }
    return {
        canonical: `@${parsed.normalized}`,
        username: parsed.normalized,
        source: parsed.source,
    };
}