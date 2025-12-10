import {proxyAddress, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./proxy_handler.js";
import {getRequestsDatabaseAdapter} from "../database.js";
import {addDnrAllowRule, addDnrBlockingRule, fetchNextDnrRuleId} from "./dnr_handler.js";
import {globalStrictMode} from "../background.js";
import {policyCookie} from "./geofence_handler.js";

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

export async function isHostScion(hostname, currentTabId) {
    const databaseAdapter = await getRequestsDatabaseAdapter();

    const dnrRuleId = await fetchNextDnrRuleId();
    const requestDBEntry = {
        requestId: dnrRuleId,
        tabId: currentTabId,
        domain: hostname,
        mainDomain: hostname,
        scionEnabled: false,
        dnrRuleId: dnrRuleId, // set it to -1 by default (stays -1 for scion-enabled domains, otherwise gets assigned a proper rule id)
    };

    const fetchUrl = `${proxyAddress}${proxyHostResolvePath}?${proxyHostResolveParam}=${hostname}`;
    const response = await fetch(fetchUrl, {method: "GET"});
    if (response.ok) {
        const text = await response.text();
        if (text !== "") {
            requestDBEntry.scionEnabled = true;
            isHostnameSCION[hostname] = true;
            console.log("[DB]: scion enabled (after resolve): ", hostname);

            // TODO: expand condition to also check for perPageStrictMode
            if (globalStrictMode) await addDnrAllowRule(hostname, dnrRuleId);
        } else {
            requestDBEntry.scionEnabled = false;
            isHostnameSCION[hostname] = false;
            console.log("[DB]: scion disabled (after resolve): ", hostname);

            // TODO: expand condition to also check for perPageStrictMode
            if (globalStrictMode) await addDnrBlockingRule(hostname, dnrRuleId);
        }
        databaseAdapter.add(requestDBEntry, {
            mainDomain: requestDBEntry.mainDomain,
            scionEnabled: requestDBEntry.scionEnabled,
            domain: requestDBEntry.domain,
        });
    } else {
        console.warn("[DB]: Resolution error: ", response.status);
    }

    console.log("[DB]: Resolution returned that host is scion-capable: ", requestDBEntry.scionEnabled);
    return requestDBEntry.scionEnabled;
}

// Skip answers on a resolve request with a status code 500 if the host is not scion capable
function onHeadersReceived(details) {
    if (details.url.startsWith(`${proxyAddress}${proxyURLResolvePath}`)) {
        console.log("[onHeadersReceived]: ", details);
        const url = new URL(details.url);
        // The actual URL that we need is in ?url=$url
        const target = url.search.split("=")[1];
        const targetUrl = new URL(target);

        if (details.statusCode >= 500) {
            isHostnameSCION[targetUrl.hostname] = true;
            fetchNextDnrRuleId().then(id => {
                addDnrBlockingRule(targetUrl.hostname, id)
            })
            console.log("<onHeadersReceived> known NON scion (after resolve): ", targetUrl.hostname)

        } else if (details.statusCode === 301) {
            fetchNextDnrRuleId().then(id => {
                addDnrAllowRule(targetUrl.hostname, id)
            })
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
