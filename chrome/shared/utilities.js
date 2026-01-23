/**
 * Normalizes the `hostname` to be in punycode format.
 * @param hostname the `hostname` to be converted.
 * @returns {string} the normalized string representation of the `hostname` in punycode format.
 */
export function normalizedHostname(hostname) {
    return new URL(`https://${hostname}`).hostname;
}

/**
 * Safely extracts the hostname in punycode format from the provided `url`.
 * If the extraction of the hostname fails, `null` is returned.
 */
export function safeHostname(url) {
    try {
        return url ? new URL(url).hostname : null;
    } catch {
        return null;
    }
}