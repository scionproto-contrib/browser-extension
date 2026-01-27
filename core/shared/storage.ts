import {handleTabChange} from "../background_helpers/tab_handler.js";

// ===== SYNC STORAGE =====
export const GLOBAL_STRICT_MODE = "globalStrictMode" as const;
export const PER_SITE_STRICT_MODE = "perSiteStrictMode" as const;
export const ISD_WHITELIST = "isd_whitelist" as const;
export const ISD_ALL = "isd_all" as const;
export const EXTENSION_RUNNING = "extension_running" as const;
export const AUTO_PROXY_CONFIG = "auto-proxy-config" as const;
export const PROXY_SCHEME = "proxyScheme" as const;
export const PROXY_HOST = "proxyHost" as const;
export const PROXY_PORT = "proxyPort" as const;

export type SyncValueSchema = {
    // proxy
    [AUTO_PROXY_CONFIG]: boolean;
    [PROXY_SCHEME]: string;
    [PROXY_HOST]: string;
    [PROXY_PORT]: string;

    // strict modes
    [GLOBAL_STRICT_MODE]: boolean;
    [PER_SITE_STRICT_MODE]: Record<string, boolean>;

    // ISDs
    [ISD_WHITELIST]: string[];
    [ISD_ALL]: boolean;

    // misc.
    [EXTENSION_RUNNING]: boolean;
};
// ========================

// ===== SESSION STORAGE =====
type SessionValueSchema = Record<string, boolean>;
// ===========================

// ===== LOCAL STORAGE =====
const REQUESTS = "requests" as const;
export const DOMAIN = "domain" as const;
export const MAIN_DOMAIN = "mainDomain" as const;
export const SCION_ENABLED = "scionEnabled" as const;

export type RequestSchema = {
    [DOMAIN]: string;
    [MAIN_DOMAIN]: string;
    [SCION_ENABLED]: boolean;
};
type RequestsSchema = {
    [REQUESTS]: RequestSchema[];
};
/**
 * Note that the string corresponding to the `REQUESTS` key is a serialized representation of the `RequestsSchema` type.
 */
type LocalValueSchema = {
    [REQUESTS]: string;
};
// =========================

// ===== LOCAL STORAGE TAB RESOURCES =====
/*
Instead of keeping a map in a single key in local storage as done with the requests, here
each host for each tab is its own key to a boolean indicating whether the host is scion-capable.
The reason not to use a map is the possibility of data races (see the requests' description below why
this is not an issue there):
- When two requests to subresources are made asynchronously, both read the map, make their change
  and save it, thus one change gets overwritten. Such a history might be: rA, rB, wA, wB.
  Now this problem could be solved through a lock, as is done with the DNR rule IDs.
- However due to the ephemerality of service workers (SW) in MV3, it is possible that SW A makes a call
  to update the map, but before that finishes, gets torn down. SW B is immediately created and writes
  the map before the update from SW A has finished. Thus, the information SW B has written is lost, even
  if it is unrelated to the data written by A.

To mitigate this data race, we can simply not store the data in a map but rather create a separate entry
in storage for each host for each tab.
 */

// full key is of the form <TAB_RESOURCE_PREFIX>:<tabId>:<encodedHostname>
const TAB_RESOURCE_PREFIX = "tabResource";

function getHostResourceKey(tabId: number, hostname: string): string {
    const encodedHostname: string = encodeURIComponent(hostname.toLowerCase());
    return `${TAB_RESOURCE_PREFIX}:${tabId}:${encodedHostname}`;
}

function getTabResourceKeyPrefix(tabId: number): string {
    return `${TAB_RESOURCE_PREFIX}:${tabId}:`;
}

/**
 * Returns a list of [hostnames, scionEnabled] tuples of resources the tab with `tabId` requested.
 * Returns an empty list if there is no entry for the `tabId`.
 */
export async function getTabResources(tabId: number): Promise<[string, boolean][]> {
    const sessionData: SessionValueSchema = await getAllSessionValues();
    const prefix: string = getTabResourceKeyPrefix(tabId);
    const result: [string, boolean][] = [];

    for (const [key, value] of Object.entries(sessionData)) {
        if (!key.startsWith(prefix)) continue;

        const encodedHostname = key.slice(prefix.length);
        const hostname = decodeURIComponent(encodedHostname);

        result.push([hostname, value]);
    }

    result.sort((a, b) => a[0].localeCompare(b[0]));
    return result;
}

/**
 * Removes all the entries for the `tabId`.
 */
export async function clearTabResources(tabId: number) {
    const all: SessionValueSchema = await getAllSessionValues();
    const prefix: string = getTabResourceKeyPrefix(tabId);

    const keysToRemove: string[] = Object.keys(all).filter(key => key.startsWith(prefix));
    if (keysToRemove.length > 0) {
        await removeSessionValues(keysToRemove);
    }
}

/**
 * Removes all entries for all tabs.
 */
export async function clearAllTabResources() {
    const all: SessionValueSchema = await getAllSessionValues();
    const keysToRemove: string[] = Object.keys(all).filter(key => key.startsWith(TAB_RESOURCE_PREFIX));
    if (keysToRemove.length > 0) {
        await removeSessionValues(keysToRemove);
    }
}

/**
 * Adds the information that `resourceHostname` (with its metainformation `resourceHostScionEnabled`) was requested by the tab with `tabId`.
 */
export async function addTabResource(tabId: number, resourceHostname: string, resourceHostScionEnabled: boolean) {
    const key: string = getHostResourceKey(tabId, resourceHostname);

    const existing: boolean | undefined = await getSessionValue(key);
    if (existing) return;

    await saveSessionValue(key, resourceHostScionEnabled);

    // in case a website needs to verify its scion capability and this information arrives after tabs.onUpdated or tabs.onActivated,
    // this call ensures the icon is updated properly (which is used to display the info on the popup)
    const tab = await browser.tabs.get(tabId);
    await handleTabChange(tab);
}

// ====================================

// ===== REQUESTS ENTRY =====
// Data races are not a real concern for the requests table, as this is not something the user will see/notice.
// Instead, if a race causes the result of one lookup to be lost, the extension will continue operating as normal
// and will simply refetch that resource later on if it is requested again (since the entry does not exist, from
// its perspective it considers this host to be unknown).

const MAX_REQUEST_ENTRIES = 50; // keep list small (sync storage quota)

async function loadRequests(): Promise<RequestSchema[]> {
    const serializedRequests = await getLocalValue(REQUESTS);
    if (serializedRequests && serializedRequests !== "") {
        try {
            const requestsObject = JSON.parse(serializedRequests) as RequestsSchema;
            if (!requestsObject[REQUESTS]) return [];
            return requestsObject[REQUESTS];
        } catch {
            return [];
        }
    }

    return [];
}

/**
 * Returns a list of requests that match the condition provided in the `filter` or all requests
 * if `filter` is left `undefined`.
 *
 * Note that hostnames in request-entries are in punycode format.
 */
export async function getRequests<K extends keyof RequestSchema>(filter: Partial<RequestSchema> | undefined = undefined): Promise<RequestSchema[]> {
    let requests: RequestSchema[] = await loadRequests();
    if (filter === undefined) return requests;

    const keys = Object.keys(filter) as K[];
    keys.forEach((key: K) => {
        requests = requests.filter((requestEntry: RequestSchema) => requestEntry[key] === filter[key]);
    })
    return requests;
}

/**
 * Returns the first request that matches the condition provided in the `filter` or the overall
 * first request if `filter` is left `undefined`.
 *
 * Note that hostnames in request-entries are in punycode format.
 */
export async function firstRequest(filter: Partial<RequestSchema> | undefined = undefined): Promise<RequestSchema | null> {
    const filteredRequests: RequestSchema[] = await getRequests(filter);
    if (!filteredRequests || filteredRequests.length === 0) return null;
    return filteredRequests[0];
}

/**
 * Adds the provided `entry` to the list of requests or updates the first one request that matches
 * the `replaceFilter`.
 *
 * Note that the hostnames contained in `entry` must already be in punycode format (see {@link normalizedHostname}).
 */
export async function addRequest<K extends keyof RequestSchema>(entry: RequestSchema, replaceFilter: Partial<RequestSchema> | undefined = undefined) {
    const requests: RequestSchema[] = await loadRequests();
    while (requests.length > MAX_REQUEST_ENTRIES) requests.shift();

    if (replaceFilter === undefined) {
        requests.push(entry);
    } else {

        const index: number = requests.findIndex((requestEntry: RequestSchema) => {
            let match = true;
            const keys = Object.keys(replaceFilter) as K[];
            for (const key of keys) {
                if (requestEntry[key] !== replaceFilter[key]) {
                    match = false;
                    break;
                }
            }
            return match;
        });

        if (index < 0) requests.push(entry);
        else {
            requests[index] = {...requests[index], ...entry};
        }
    }

    await saveLocalValue(REQUESTS, JSON.stringify({requests}));
}

// ==========================

// ===== CHROME STORAGE WRAPPER FUNCTIONS =====
export async function saveSyncValue<K extends keyof SyncValueSchema>(key: K, value: SyncValueSchema[K]) {
    await browser.storage.sync.set({[key]: value});
}

export async function getSyncValue<K extends keyof SyncValueSchema>(key: K): Promise<SyncValueSchema[K] | undefined>;
export async function getSyncValue<K extends keyof SyncValueSchema>(key: K, fallback: SyncValueSchema[K]): Promise<SyncValueSchema[K]>;

export async function getSyncValue<K extends keyof SyncValueSchema>(key: K, fallback?: SyncValueSchema[K]): Promise<SyncValueSchema[K] | undefined> {
    const result = await browser.storage.sync.get([key]);
    if (result && result[key]) return result[key] as SyncValueSchema[K];
    return fallback;
}

export async function saveSyncValues<K extends keyof SyncValueSchema>(keyValuePairs: Partial<Record<K, SyncValueSchema[K]>>) {
    await browser.storage.sync.set(keyValuePairs);
}

/**
 * Accesses the `chrome.storage.sync` storage for multiple keys at once. For each key, a fallback value must be provided.
 *
 * NOTE: The `Pick` syntax is used to ensure that entries, for which a key/fallback pair was provided are not marked as possibly undefined
 * when accessing them from the returned object. (see annotation in example)
 *
 * @param keysWithFallbacks a dictionary mapping the keys that are being requested to their fallback values.
 * @example
 *  getStorageValues({
 *      [SyncStorageEntry.ProxyScheme]: DEFAULT_HTTPS_PROXY_SCHEME,
 *      [SyncStorageEntry.ProxyHost]: DEFAULT_PROXY_HOST,
 *      [SyncStorageEntry.ProxyPort]: DEFAULT_HTTPS_PROXY_PORT,
 *  }).then(async (items) => {
 *      let proxyHost = items[SyncStorageEntry.ProxyHost]; // <-- e.g. here, by using Pick, proxyHost is not 'string | undefined' but just 'string'
 *      let proxyPort = items[SyncStorageEntry.ProxyPort];
 *      let proxyScheme = items[SyncStorageEntry.ProxyScheme];
 *  });
 */
export async function getSyncValues<K extends keyof SyncValueSchema>(keysWithFallbacks: Pick<SyncValueSchema, K>): Promise<Pick<SyncValueSchema, K>> {
    const keys = Object.keys(keysWithFallbacks) as K[];
    const storage = (await browser.storage.sync.get(keys)) as Partial<Pick<SyncValueSchema, K>>;
    const result = {} as Pick<SyncValueSchema, K>;
    for (const key of keys) result[key] = storage[key] ?? keysWithFallbacks[key];
    return result;
}

async function saveLocalValue<K extends keyof LocalValueSchema>(key: K, value: LocalValueSchema[K]) {
    await browser.storage.local.set({[key]: value});
}

async function getLocalValue<K extends keyof LocalValueSchema>(key: K): Promise<LocalValueSchema[K]> {
    const result = await browser.storage.local.get([key]);
    return result[key] as LocalValueSchema[K];
}

async function saveSessionValue(key: keyof SessionValueSchema, value: SessionValueSchema[string]) {
    await browser.storage.session.set({[key]: value});
}

async function getSessionValue(key: keyof SessionValueSchema): Promise<SessionValueSchema[string] | undefined> {
    const result = await browser.storage.session.get([key]);
    const typedResult = result as SessionValueSchema | undefined;
    if (typedResult === undefined) return undefined;
    return typedResult[key];
}

async function getAllSessionValues(): Promise<SessionValueSchema> {
    return await browser.storage.session.get() as SessionValueSchema;
}

async function removeSessionValues(keys: string[]) {
    await browser.storage.session.remove(keys);
}