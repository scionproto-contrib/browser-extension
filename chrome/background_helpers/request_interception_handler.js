import {proxyAddress, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./proxy_handler.js";
import {getRequestsDatabaseAdapter} from "../database.js";
import {addDnrAllowRule, addDnrBlockingRule, fetchNextDnrRuleId} from "./dnr_handler.js";
import {policyCookie} from "./geofence_handler.js";
import {getStorageValue} from "../shared/storage.js";

let isHostnameSCION = {};

/**
 * General request interception concept:
 * - hosts unknown to the extension are forwarded to the proxy
 * - the proxy returns either a 503 if the host is not SCION-capable or a 301 (redirect to the resource) otherwise
 * - this return value can be detected and intercepted in the `onHeadersReceived` function
 */
export function initializeRequestInterceptionListeners() {
    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, {urls: ["<all_urls>"]});

    // in manifest version 3 (MV3), the onAuthRequired is the only listener that still supports and accepts the 'blocking' extraInfoSpec
    chrome.webRequest.onAuthRequired.addListener(onAuthRequired, {urls: ["<all_urls>"]}, ['blocking']);

    chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, {urls: ["<all_urls>"]});

    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, {urls: ["<all_urls>"]});
}

export function resetKnownHostnames() {
    isHostnameSCION = {};
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
        isHostnameSCION[hostname] = scionEnabled;

        // logging
        if (scionEnabled) console.log("[DB]: scion enabled (after resolve): ", hostname);
        else console.log("[DB]: scion disabled (after resolve): ", hostname);

        const dnrRuleId = await createDBEntry(hostname, initiator, currentTabId, scionEnabled);
        await handleAddDnrRule(hostname, dnrRuleId, scionEnabled);
    } else {
        console.warn("[DB]: Resolution error: ", response.status);
    }

    console.log("[DB]: Resolution returned that host is scion-capable: ", scionEnabled);
    return scionEnabled;
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

        isHostnameSCION[targetUrl.hostname] = scionEnabled;
        asyncHelper().catch(reason => {
            console.error("[onHeadersReceived]: An error occurred during the creation of the DB entry or DNR rule: ", reason);
        });

        async function asyncHelper() {
            const dnrRuleId = await createDBEntry(targetUrl.hostname, details.initiator || "", details.tabId, scionEnabled);
            await handleAddDnrRule(targetUrl.hostname, dnrRuleId, scionEnabled);
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

// Proxy returns a valid redirect response, meaning there is SCION enabled
// and we can do this request again
function onBeforeRedirect(details) {
    if (details.redirectUrl && details.url.startsWith(`${proxyAddress}${proxyURLResolvePath}`)) {
        console.log("<onBeforeRedirect> known scion (after resolve): ", details.redirectUrl)
        const url = new URL(details.redirectUrl);
        isHostnameSCION[url.hostname] = true;
    }
}

function onErrorOccurred(details) {
    console.error("<onErrorOccurred>", details);
}

/**
 * Creates a DB entry for the provided `host` and returns the generated `dnrRuleId`.
 */
async function createDBEntry(hostname, initiator, currentTabId, scionEnabled) {
    const dnrRuleId = await fetchNextDnrRuleId();
    const requestDBEntry = {
        requestId: dnrRuleId,
        tabId: currentTabId,
        domain: hostname,
        mainDomain: initiator,
        scionEnabled: scionEnabled,
        dnrRuleId: dnrRuleId, // set it to -1 by default (stays -1 for scion-enabled domains, otherwise gets assigned a proper rule id)
    };

    const databaseAdapter = await getRequestsDatabaseAdapter();
    await databaseAdapter.add(requestDBEntry, {
        mainDomain: requestDBEntry.mainDomain,
        scionEnabled: requestDBEntry.scionEnabled,
        domain: requestDBEntry.domain,
    });

    return dnrRuleId;
}

/**
 * Checks whether `globalStrictMode` or `perSiteStrictMode` for the provided `hostname` are enabled and,
 * if either is true, adds the rule depending on whether `scionEnabled` for this host.
 */
async function handleAddDnrRule(hostname, dnrRuleId, scionEnabled) {
    const globalStrictMode = await getStorageValue("globalStrictMode");
    const perSiteStrictMode = await getStorageValue("perSiteStrictMode");
    const strictHosts = Object.entries(perSiteStrictMode)
        .filter(entry => entry.value)
        .map(entry => entry.key);

    if (globalStrictMode || strictHosts.includes(hostname)) {
        if (scionEnabled) await addDnrAllowRule(hostname, dnrRuleId);
        else await addDnrBlockingRule(hostname, dnrRuleId);
    }
}
