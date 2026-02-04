export function normalizeTelegramUsername(input?: string | null): string | null {
    if (input == null) {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    const withoutAt = trimmed.replace(/^@+/, '').trim();
    if (!withoutAt) {
        return null;
    }

    return withoutAt.toLowerCase();
}