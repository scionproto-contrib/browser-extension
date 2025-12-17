import {proxyAddress, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./proxy_handler.js";
import {addDnrRule} from "./dnr_handler.js";
import {policyCookie} from "./geofence_handler.js";
import {addRequest, addTabResource, getSyncValue} from "../shared/storage.js";

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
}

export async function isHostScion(hostname, initiator, currentTabId) {
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

        await handleAddDnrRule(hostname, scionEnabled);
        await createDBEntry(hostname, initiator, currentTabId, scionEnabled);
    } else {
        console.warn("[DB]: Resolution error: ", response.status);
    }

    console.log("[DB]: Resolution returned that host is scion-capable: ", scionEnabled);
    return scionEnabled;
}

function onBeforeRequest(details) {
    // TODO: additionally, create the entries through addTabResource here too (for those hosts where we know whether they are scion or not (those in sync storage), since for the others, a lookup and then add-call will be performed anyway)
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
            const initiatorUrl = details.initiator ? new URL(details.initiator) : null;
            await handleAddDnrRule(targetUrl.hostname, scionEnabled);
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
async function handleAddDnrRule(hostname, scionEnabled) {
    const globalStrictMode = await getSyncValue("globalStrictMode");
    const perSiteStrictMode = await getSyncValue("perSiteStrictMode");

    let strictHosts = [];
    if (perSiteStrictMode) {
        strictHosts = Object.entries(perSiteStrictMode)
            .filter(([, isScion]) => isScion)
            .map(([host]) => host);
    }

    if (globalStrictMode || strictHosts.includes(hostname)) {
        await addDnrRule(hostname, scionEnabled);
    }
}
