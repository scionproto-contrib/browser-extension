import {getSyncValue, GLOBAL_STRICT_MODE, PER_SITE_STRICT_MODE, saveSyncValue, type SyncValueSchema} from "./storage.js";

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
 * A value indicating whether the current environment is Chromium-based.
 *
 * This is evaluated by checking the extension URL which is of the form: `<browser>-extension://<extension-UUID>`
 * where `<browser>` is:
 * - `chrome` for Chromium-based browsers like Opera, Brave or Chrome
 * - `moz` for Firefox
 */
export let IsChromium: boolean;

export function initializeIsChromium() {
    const extensionUrl = browser.runtime.getURL("");
    IsChromium =  extensionUrl.includes("chrome");
}

export let GlobalStrictMode: SyncValueSchema[typeof GLOBAL_STRICT_MODE] = false;
export let PerSiteStrictMode: SyncValueSchema[typeof PER_SITE_STRICT_MODE] = {};

export async function initializeStrictModes() {
    const storageGlobalStrictMode = await getSyncValue(GLOBAL_STRICT_MODE);
    GlobalStrictMode = storageGlobalStrictMode ?? false;
    if (storageGlobalStrictMode === undefined) await saveSyncValue(GLOBAL_STRICT_MODE, GlobalStrictMode);
    console.log("[initializeStrictModes]: GlobalStrictMode:", GlobalStrictMode);

    const storagePerSiteStrictMode = await getSyncValue(PER_SITE_STRICT_MODE);
    PerSiteStrictMode = storagePerSiteStrictMode ?? {};
    if (storagePerSiteStrictMode === undefined) await saveSyncValue(PER_SITE_STRICT_MODE, PerSiteStrictMode);
    console.log("[initializeStrictModes]: PerSiteStrictMode:", PerSiteStrictMode);
}

export function setGlobalStrictMode(globalStrictMode: SyncValueSchema[typeof GLOBAL_STRICT_MODE]) {
    GlobalStrictMode = globalStrictMode;
}

export function setPerSiteStrictMode(perSiteStrictMode: SyncValueSchema[typeof PER_SITE_STRICT_MODE]) {
    PerSiteStrictMode = perSiteStrictMode;
}