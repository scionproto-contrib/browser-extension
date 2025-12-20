/**
 * Normalizes the hostname by removing (if existing) the `www.` prefix.
 *
 * Given the limitation of DNR rules of not being able to explicitly match exact domains (e.g. 'google.com' also matches 'www.google.com'),
 * a simplification via the removal of the `www.` prefix can be made. This ensures consistency, as it can occur that the user requests a URL
 * such as 'google.com', the proxy lookup is performed for that URL in the checking.html page but if the user is redirected to that page, this
 * URL might itself be redirected to 'www.google.com' which the extension no longer would recognise.
 */
export function normalizedHostname(hostname) {
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Safely extracts the hostname from the provided `url` and normalizes it via `normalizedHostname`.
 * If an error occurs during the extraction process, `null` is returned.
 */
export function safeHostname(url) {
    try {
        return url ? normalizedHostname(new URL(url).hostname) : null;
    } catch {
        return null;
    }
}