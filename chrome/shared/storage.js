// TODO: Wrap for Firefox to achieve same API

export async function saveSyncValue(key, value) {
    await chrome.storage.sync.set({[key]: value});
}

export async function getSyncValue(key) {
    const result = await chrome.storage.sync.get([key]);
    return result[key];
}

export async function saveLocalValue(key, value) {
    await chrome.storage.local.set({[key]: value});
}

export async function getLocalValue(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
}

// ===== LOCAL STORAGE TAB_ID MAP =====
// Contains a map in local storage that maps a `tabId` to the hostnames of the resources that tab requested

const TAB_RESOURCES = "tabResources";

/**
 * Returns a list of [hostnames, scionEnabled] tuples of resources the tab with `tabId` requested.
 * Returns null if the dictionary itself or the entry for `tabId` do not exist.
 */
export async function getTabResources(tabId) {
    const tabResources = await getLocalValue(TAB_RESOURCES);
    if (!tabResources || !tabResources[tabId]) return null;
    return tabResources[tabId];
}

/**
 * Resets the entry for the `tabId` to an empty list if that entry exists.
 */
export async function clearTabResources(tabId) {
    const tabResources = await getLocalValue(TAB_RESOURCES);
    // ignore cases where the dictionary itself or the entry for `tabId` do not exist
    if (!tabResources || !tabResources[tabId]) return;
    tabResources[tabId] = [];
    await saveLocalValue(TAB_RESOURCES, tabResources);
}

export async function deleteTabResources(tabId) {
    const tabResources = await getLocalValue(TAB_RESOURCES);
    if (!tabResources || !tabResources[tabId]) return;
    delete tabResources[tabId];
    await saveLocalValue(TAB_RESOURCES, tabResources);
}

/**
 * Adds the [`resourceHostname`, `resourceHostScionEnabled`] tuple to the list of resources requested by the tab with `tabId`.
 */
export async function addTabResource(tabId, resourceHostname, resourceHostScionEnabled) {
    const entry = [resourceHostname, resourceHostScionEnabled];

    let tabResources = await getLocalValue(TAB_RESOURCES);
    if (!tabResources) {
        // case: the dictionary does not exist
        tabResources = {};
        tabResources[tabId] = [entry];
    } else {
        if (!tabResources[tabId]) {
            // case: the dictionary exists, but does not contain `tabId` as a key
            tabResources[tabId] = [entry];
        } else {
            // case: the dictionary exists and contains `tabId` as a key, thus this entry must be updated
            const newResources = tabResources[tabId];
            newResources.push(entry);
            tabResources[tabId] = newResources;
        }
    }

    await saveLocalValue(TAB_RESOURCES, tabResources);
}

// ====================================

// ===== SYNC STORAGE REQUESTS ENTRY =====

const REQUESTS = "requests";
const MAX_REQUEST_ENTRIES = 50; // keep list small (sync storage quota)

async function loadRequests() {
    const serializedRequests = await getSyncValue(REQUESTS);
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

export async function getRequests(filter = undefined) {
    let requests = await loadRequests();
    Object.keys(filter || {}).forEach((key) => {
        requests = requests.filter(requestEntry => requestEntry[key] === filter[key]);
    })
    return requests;
}

export async function firstRequest(filter = undefined) {
    const filteredRequests = await getRequests(filter);
    if (!filteredRequests || filteredRequests.length === 0) return null;
    return filteredRequests[0];
}

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

    await saveSyncValue(REQUESTS, JSON.stringify({requests}));
}

export async function updateRequest(requestId, newEntry) {
    const requests = await loadRequests();
    const entryIndex = requests.findIndex(requestEntry => requestEntry.requestId === requestId);
    if (entryIndex < 0) return null;

    const updatedRequest = {...requests[entryIndex], ...newEntry};
    requests[entryIndex] = updatedRequest;

    await saveSyncValue(REQUESTS, JSON.stringify({requests}));
    return updatedRequest;
}

// =======================================
