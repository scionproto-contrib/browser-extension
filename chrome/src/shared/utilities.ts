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
 * Converts a given array into its `Set` representation.
 * @typeParam T the type of item inside the array/set.
 * @param array the array to be converted into a set.
 */
export function toSet<T>(array: T[]): Promise<Set<T>> {
    return new Promise(resolve => {
        resolve(new Set(array));
    });
}

/**
 * Removes all elements from the {@link list} that evaluate to a falsey value and returns the list again.
 */
export function removeEmptyEntries<T>(list: T[]): T[] {
    if (!list) {
        return list;
    }
    return list.filter((l: T) => !!l);
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