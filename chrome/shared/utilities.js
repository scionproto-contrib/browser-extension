/**
 * Safely extracts the hostname from the provided `url`.
 * If the extraction of the hostname fails, `null` is returned.
 */
export function safeHostname(url) {
    try {
        return url ? new URL(url).hostname : null;
    } catch {
        return null;
    }
}