import {handleTabChange} from "../background_helpers/tab_handler.js";

export const GLOBAL_STRICT_MODE = "globalStrictMode";
export const PER_SITE_STRICT_MODE = "perSiteStrictMode";
export const ISD_WHITELIST = "isd_whitelist";
export const ISD_ALL = "isd_all";
export const EXTENSION_RUNNING = "extension_running";

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

function getHostResourceKey(tabId, hostname) {
    const encodedHostname = encodeURIComponent(hostname.toLowerCase());
    return `${TAB_RESOURCE_PREFIX}:${tabId}:${encodedHostname}`;
}

function getTabResourceKeyPrefix(tabId) {
    return `${TAB_RESOURCE_PREFIX}:${tabId}:`;
}

/**
 * Returns a list of [hostnames, scionEnabled] tuples of resources the tab with `tabId` requested.
 * Returns an empty list if there is no entry for the `tabId`.
 */
export async function getTabResources(tabId) {
    const sessionData = await getAllSessionValues();
    const prefix = getTabResourceKeyPrefix(tabId);
    const result = [];

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
export async function clearTabResources(tabId) {
    const all = await getAllSessionValues();
    const prefix = getTabResourceKeyPrefix(tabId);

    const keysToRemove = Object.keys(all).filter(key => key.startsWith(prefix));
    if (keysToRemove.length > 0) {
        await removeSessionValues(keysToRemove);
    }
}

/**
 * Removes all entries for all tabs.
 */
export async function clearAllTabResources() {
    const all = await getAllSessionValues();
    const keysToRemove = Object.keys(all).filter(key => key.startsWith(TAB_RESOURCE_PREFIX));
    if (keysToRemove.length > 0) {
        await removeSessionValues(keysToRemove);
    }
}

/**
 * Adds the information that `resourceHostname` (with its metainformation `resourceHostScionEnabled`) was requested by the tab with `tabId`.
 */
export async function addTabResource(tabId, resourceHostname, resourceHostScionEnabled) {
    const key = getHostResourceKey(tabId, resourceHostname);

    const existing = await getSessionValue(key);
    if (existing && existing[key] !== undefined) return;

    await saveSessionValue(key, resourceHostScionEnabled);

    // in case a website needs to verify its scion capability and this information arrives after tabs.onUpdated or tabs.onActivated,
    // this call ensures the icon is updated properly (which is used to display the info on the popup)
    const tab = await chrome.tabs.get(tabId);
    await handleTabChange(tab);
}

// ====================================

// ===== REQUESTS ENTRY =====
// Data races are not a real concern for the requests table, as this is not something the user will see/notice.
// Instead, if a race causes the result of one lookup to be lost, the extension will continue operating as normal
// and will simply refetch that resource later on if it is requested again (since the entry does not exist, from
// its perspective it considers this host to be unknown).

const REQUESTS = "requests";
const MAX_REQUEST_ENTRIES = 50; // keep list small (sync storage quota)

async function loadRequests() {
    const serializedRequests = await getLocalValue(REQUESTS);
    if (serializedRequests && serializedRequests !== "") {
        try {
            const requestsObject = JSON.parse(serializedRequests);
            if (!requestsObject.requests) return [];
            return requestsObject.requests;
        } catch {
            return [];
        }
    }

    return [];
}

/**
 * Returns a list of requests that match the condition provided in the `filter` or all requests
 * if `filter` is left `undefined`.
 */
export async function getRequests(filter = undefined) {
    let requests = await loadRequests();
    Object.keys(filter || {}).forEach((key) => {
        requests = requests.filter(requestEntry => requestEntry[key] === filter[key]);
    })
    return requests;
}

/**
 * Returns the first request that matches the condition provided in the `filter` or the overall
 * first request if `filter` is left `undefined`.
 */
export async function firstRequest(filter = undefined) {
    const filteredRequests = await getRequests(filter);
    if (!filteredRequests || filteredRequests.length === 0) return null;
    return filteredRequests[0];
}

/**
 * Adds the provided `entry` to the list of requests or updates the first one request that matches
 * the `replaceFilter`.
 */
export async function addRequest(entry, replaceFilter = undefined) {
    const requests = await loadRequests();
    while (requests.length > MAX_REQUEST_ENTRIES) requests.shift();

    if (!replaceFilter) {
        requests.push(entry);
    } else {
        const index = requests.findIndex(requestEntry => {
            let match = true;
            const keys = Object.keys(replaceFilter);
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
export async function saveSyncValue(key, value) {
    await chrome.storage.sync.set({[key]: value});
}

export async function getSyncValue(key) {
    const result = await chrome.storage.sync.get([key]);
    return result[key];
}

async function saveLocalValue(key, value) {
    await chrome.storage.local.set({[key]: value});
}

async function getLocalValue(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
}

async function saveSessionValue(key, value) {
    await chrome.storage.session.set({[key]: value});
}

async function getSessionValue(key) {
    const result = await chrome.storage.session.get([key]);
    return result[key];
}

async function getAllSessionValues() {
    return await chrome.storage.session.get();
}

async function removeSessionValues(keys) {
    await chrome.storage.session.remove(keys);
}