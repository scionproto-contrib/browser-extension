import {proxyAddress, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./proxy_handler.js";
import {addDnrRule} from "./dnr_handler.js";
import {policyCookie} from "./geofence_handler.js";
import {addRequest, addTabResource, clearTabResources, getRequests, getSyncValue, GLOBAL_STRICT_MODE, PER_SITE_STRICT_MODE} from "../shared/storage.js";

/**
 * General request interception concept:
 * - hosts unknown to the extension are forwarded to the proxy
 * - the proxy returns either a 503 if the host is not SCION-capable or a 301 (redirect to the resource) otherwise
 * - this return value can be detected and intercepted in the `onHeadersReceived` function
 */
export function initializeRequestInterceptionListeners() {
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, {urls: ["<all_urls>"]});

    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, {urls: ["<all_urls>"]});

    // in manifest version 3 (MV3), the onAuthRequired is the only listener that still supports and accepts the 'blocking' extraInfoSpec
    chrome.webRequest.onAuthRequired.addListener(onAuthRequired, {urls: ["<all_urls>"]}, ['blocking']);

    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, {urls: ["<all_urls>"]});

    chrome.webNavigation.onCommitted.addListener(onCommitted);
}

export async function isHostScion(hostname, initiator, currentTabId, alreadyHasLock = false) {
    let scionEnabled = false;

    const fetchUrl = `${proxyAddress}${proxyHostResolvePath}?${proxyHostResolveParam}=${hostname}`;
    const response = await fetch(fetchUrl, {method: "GET"});
    if (response.ok) {
        const text = await response.text();
        // the response text contains the SCION ISD path, or an empty string if the host is not
        // reachable through SCION
        scionEnabled = text !== "";

        // logging
        if (scionEnabled) console.log("[DB]: scion enabled (after resolve): ", hostname);
        else console.log("[DB]: scion disabled (after resolve): ", hostname);

        await handleAddDnrRule(hostname, scionEnabled, alreadyHasLock);
        await createDBEntry(hostname, initiator, currentTabId, scionEnabled);
    } else {
        console.warn("[DB]: Resolution error: ", response.status);
    }

    console.log("[DB]: Resolution returned that host is scion-capable: ", scionEnabled);
    return scionEnabled;
}

// map that maps tabId to promises (which act as locks)
const perTabLocks = new Map();

function withTabLock(tabId, fn) {
    const prev = perTabLocks.get(tabId) ?? Promise.resolve();
    const next = prev
        .catch(() => {
        })
        .then(fn)
        .finally(() => {
            if (perTabLocks.get(tabId) === next) perTabLocks.delete(tabId);
        });
    perTabLocks.set(tabId, next);
    return next;
}

// map that maps the tabId to a state (of type: { gen, topOrigin, currentDocumentId }
const tabState = new Map();

function safeHostname(url) {
    try {
        const u = new URL(url);
        // ignore internal or otherwise undesired requests
        if (u.protocol === "chrome-extension:" || u.protocol === "chrome:" || u.protocol === "about:" || u.protocol === "data:" || u.protocol === "blob:") {
            return null;
        }
        return u.hostname || null;
    } catch {
        return null;
    }
}

function safeOrigin(url) {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

function safeInitiatorHostname(initiator) {
    try {
        return initiator ? new URL(initiator).hostname : null;
    } catch {
        return null;
    }
}

function onCommitted(details) {
    if (details.tabId < 0) return;

    // this logic here most likely ignores iframes...
    if (details.frameId !== 0) return;

    withTabLock(details.tabId, async () => {
        const state = tabState.get(details.tabId) ?? {gen: 0, topOrigin: null, currentDocId: null};
        tabState.set(details.tabId, {
            ...state,
            topOrigin: safeOrigin(details.url),
            currentDocId: details.documentId ?? null,
        });
    });
}

function onBeforeRequest(details) {
    const tabId = details.tabId;
    if (tabId === chrome.tabs.TAB_ID_NONE || tabId < 0) return;

    const hostname = safeHostname(details.url);
    if (!hostname) return;

    withTabLock(tabId, async () => {
        let state = tabState.get(tabId) ?? {gen: 0, topOrigin: null, currentDocId: null};

        // if a mainframe is detected, immediately reset the tab resources (since a new page was opened in an existing tab,
        // thus previous information should be removed)
        if (details.type === "main_frame") {
            state = {gen: state.gen + 1, topOrigin: safeOrigin(details.url), currentDocId: null};
            tabState.set(tabId, state);
            await clearTabResources(tabId);

            // from testing, mainframe requests usually did not contain a documentId, onCommitted mainframe requests
            // however do, so we handle setting the new documentId in the onCommitted method as it is generally invoked
            // before onBeforeRequest anyway
        }

        // ignore requests if the documentId does not match the one observed in onCommitted
        // If the case (was never the case in testing) should occur where onCommitted is invoked after a subresource
        // invokes onBeforeRequest, it is currently ignored. A future fix would be keep a buffer of non-matching requests.
        // Due to results from testing and simplicity (since this is purely for UI information), it was left out for now.
        const docId = details.documentId ?? null;
        const currentDocId = state.currentDocId;

        // note that the two following if-statements are intentionally left empty for improved structure/documentation
        if (currentDocId && docId && docId === currentDocId) {
            // accept and handle request if the documentId matches the committed documentId stored in the state
        } else if (currentDocId && !docId && state.topOrigin && details.initiator === state.topOrigin) {
            // fallback solution in case a request does not contain a documentId at all:
            // if the initiator matches the url that was present in the onCommitted call of the mainframe, that is
            // also accepted and handled
        } else {
            // reject cases where the documentId and initiator do not match
            console.log("[onBeforeRequest]: Seems to be a request unrelated to the current tab: ", details);
            return;
        }

        // ===== CREATE TAB RESOURCES ENTRY =====
        const globalStrictMode = await getSyncValue(GLOBAL_STRICT_MODE);
        const perSiteStrictMode = (await getSyncValue(PER_SITE_STRICT_MODE)) || {};

        const requests = await getRequests();
        const hostnameScionEnabled = requests.find((request) => request.domain === hostname)?.scionEnabled;

        const initiatorHostname = safeInitiatorHostname(details.initiator);
        // for mainframe, check the hostname, for subresources check the initiator whether it is set to strict
        const strictKey = details.type === "main_frame" ? hostname : initiatorHostname;

        if (globalStrictMode || (strictKey && perSiteStrictMode[strictKey])) {
            // if it has not been discovered previously, ignore it since the DNR redirect rule will catch it
            // in strict mode and then perform the lookup (or in case of perSiteStrictMode, the lookup is already
            // performed if the user enters an unknown url there)
            if (hostnameScionEnabled === undefined) {
                console.log(`[onBeforeRequest]: Strict mode enabled and host '${hostname}' unknown, skipping to let redirect handle it.`);
                return;
            }

            console.log(`[onBeforeRequest]: Strict mode enabled, host '${hostname}' is known to be scion: ${hostnameScionEnabled}`);

            // however, for previously discovered hostnames, we do need to add the resource here manually, since
            // the higher-priority DNR rule will otherwise capture it and bypass the redirect-lookup-add chain
            await addTabResource(tabId, hostname, hostnameScionEnabled);

        } else {
            if (hostnameScionEnabled === undefined) {
                console.log(`[onBeforeRequest]: Strict mode disabled, host '${hostname}' is unknown, lookup is performed.`);

                // perform a lookup for the host, if it has not been discovered previously and strict mode is off
                await isHostScion(hostname, initiatorHostname ?? hostname, tabId);
                return;
            }

            console.log(`[onBeforeRequest]: Strict mode disabled, host '${hostname}' is known to be scion: ${hostnameScionEnabled}`);
            await addTabResource(tabId, hostname, hostnameScionEnabled);
        }
    });
}

// Skip answers on a resolve request with a status code 500 if the host is not scion capable
function onHeadersReceived(details) {
    if (details.url.startsWith(`${proxyAddress}${proxyURLResolvePath}`)) {
        const url = new URL(details.url);
        // the actual URL that we need is in ?url=$url
        const target = url.search.split("=")[1];
        const targetUrl = new URL(target);

        // the proxy is expected to return a 503 if the host is not SCION-capable and 301 (redirect) otherwise
        if (details.statusCode < 500 && details.statusCode !== 301) {
            console.error(`[onHeadersReceived]: Got an unexpected result from the proxy for host ${targetUrl.hostname}: `, details);
            return;
        }

        let scionEnabled = details.statusCode === 301;

        // logging
        if (scionEnabled) console.log("[onHeadersReceived]: scion enabled (after resolve): ", targetUrl.hostname);
        else console.log("[onHeadersReceived]: scion disabled (after resolve): ", targetUrl.hostname);

        asyncHelper().catch(reason => {
            console.error("[onHeadersReceived]: An error occurred during the creation of the DB entry or DNR rule: ", reason);
        });

        async function asyncHelper() {
            const initiatorUrl = safeInitiatorHostname(details.initiator);
            await handleAddDnrRule(targetUrl.hostname, scionEnabled, false);
            await createDBEntry(targetUrl.hostname, initiatorUrl?.hostname || "", details.tabId, scionEnabled);
        }
    }
}

// Proxy requires the Proxy-Authorization header to be set,
// (if not it send back a Proxy-Authenticate header and triggers this function)
// the header has to contain the path policy cookie that is aquired by the first request
// and updated on setPolicy requests as there is no other way to pass the path policy into the
// Proxy for HTTPS requests (aka encrypted)
function onAuthRequired(details) {
    console.log("<onAuthRequired>", details);
    console.log("PolicyCookie: ", policyCookie);

    let cookieInDisguise = ""
    if (policyCookie != null) {
        cookieInDisguise = policyCookie.name + "=" + policyCookie.value
    }

    return {
        authCredentials: {
            username: "policy", // garbage value
            password: cookieInDisguise // might be empty but this is fine as we only need a possibility to inject the path policy cookie
        }
    };
}

function onErrorOccurred(details) {
    console.error("<onErrorOccurred>", details);
}

/**
 * Creates a DB entry for the provided `host` and returns the generated `dnrRuleId`.
 */
async function createDBEntry(hostname, initiator, currentTabId, scionEnabled) {
    const requestDBEntry = {
        domain: hostname,
        mainDomain: initiator,
        scionEnabled: scionEnabled,
    };

    await addRequest(requestDBEntry, {
        mainDomain: requestDBEntry.mainDomain,
        scionEnabled: requestDBEntry.scionEnabled,
        domain: requestDBEntry.domain,
    });

    if (currentTabId !== chrome.tabs.TAB_ID_NONE) await addTabResource(currentTabId, hostname, scionEnabled);
}

/**
 * Checks whether `globalStrictMode` or `perSiteStrictMode` for the provided `hostname` are enabled and,
 * if either is true, adds the rule depending on whether `scionEnabled` for this host.
 */
async function handleAddDnrRule(hostname, scionEnabled, alreadyHasLock) {
    const globalStrictMode = await getSyncValue(GLOBAL_STRICT_MODE);
    const perSiteStrictMode = await getSyncValue(PER_SITE_STRICT_MODE);

    let strictHosts = [];
    if (perSiteStrictMode) {
        strictHosts = Object.entries(perSiteStrictMode)
            .filter(([, isScion]) => isScion)
            .map(([host]) => host);
    }

    if (globalStrictMode || strictHosts.includes(hostname)) {
        await addDnrRule(hostname, scionEnabled, alreadyHasLock);
    }
}
