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
