/**
 * Normalizes the `hostname` to be in punycode format.
 * @param hostname the `hostname` to be converted.
 * @returns {string} the normalized string representation of the `hostname` in punycode format.
 */
export function normalizedHostname(hostname: string): string {
    return new URL(`https://${hostname}`).hostname;
}

/**
 * Safely extracts the hostname in punycode format from the provided `url`.
 * If the extraction of the hostname fails, `null` is returned.
 */
export function safeHostname(url: string | URL): string | null {
    try {
        return url ? new URL(url).hostname : null;
    } catch {
        return null;
    }
}

/**
 * Returns whether the current environment is Chromium-based.
 *
 * This is evaluated by checking the extension URL which is of the form: `<browser>-extension://<extension-UUID>`
 * where `<browser>` is:
 * - `chrome` for Chromium-based browsers like Opera, Brave or Chrome
 * - `moz` for Firefox
 */
export function isChromium(): boolean {
    const extensionUrl = browser.runtime.getURL("");
    return extensionUrl.includes("chrome");
}