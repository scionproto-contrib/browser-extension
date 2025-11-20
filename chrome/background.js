// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {fetchAndApplyScionPAC, loadProxySettings} from "./background_helpers/pac_handler.js";
import {allowAllgeofence, geofence} from "./background_helpers/geofence_handler.js";

const HTTPS_PROXY_SCHEME = "https"
const HTTP_PROXY_SCHEME = "http"
const DEFAULT_PROXY_HOST = "forward-proxy.scion";
const HTTPS_PROXY_PORT = "9443";
const HTTP_PROXY_PORT = "9080";

const proxyHostResolvePath = "/resolve"
const proxyHostResolveParam = "host"
const proxyURLResolvePath = "/redirect"
const proxyURLResolveParam = "url"
const proxyPolicyPath = "/policy"
const proxyHealthCheckPath = "/health"

let proxyScheme = HTTPS_PROXY_SCHEME;
let proxyHost =  DEFAULT_PROXY_HOST;
let proxyPort = HTTPS_PROXY_PORT;
let proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;


/** Background State */
let globalStrictMode = false;
let perSiteStrictMode = {};
let knownNonSCION = {};
let knownSCION = {};
let policyCookie = null

// This is a bit hacky but probably easier than wrapping everything
// in a bunder step
const imports = [
    'database.js'
];

// communication between the popup/options and background happens over the database
var getRequestsDatabaseAdapter;

/*--- setup ------------------------------------------------------------------*/

// TODO: if there are some race conditions, add a startup
// function that is called manually after all scripts are loaded
// Let's later move to something that allows using imports and
// maybe even typescript, e.g. https://github.com/abhijithvijayan/web-extension-starter
(async () => {
    const src = chrome.extension.getURL('database.js');
    const req = await import(src);
    getRequestsDatabaseAdapter = req.getRequestsDatabaseAdapter;
})();

getStorageValue('perSiteStrictMode').then((val) => {
    perSiteStrictMode = val || {}; // Here we may get undefined which is bad
});

getStorageValue('globalStrictMode').then((val) => {
    globalStrictMode = !!val;
});

// Do icon setup etc at startup
getStorageValue('extension_running').then(extensionRunning => {
    updateRunningIcon(extensionRunning);
});


/*--- PAC --------------------------------------------------------------------*/
// Load saved configuration at startup
chrome.storage.sync.get({autoProxyConfig: true}, ({autoProxyConfig}) => {
    if (autoProxyConfig) {
        fetchAndApplyScionPAC();
    } else {
        loadProxySettings();
    }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "fetchAndApplyScionPAC") {
        fetchAndApplyScionPAC();
        return true;
    }
});
/*--- END PAC ----------------------------------------------------------------*/

/*--- storage ----------------------------------------------------------------*/

chrome.storage.onChanged.addListener((changes, namespace) => {
    // In case we disable running for the extension, lets put an empty set for now
    // Later, we could remove the PAC script, but doesn't impact us now...
    if (namespace == 'sync' && changes.extension_running?.newValue !== undefined) {
        updateRunningIcon(changes.extension_running.newValue);
    } else if (namespace == 'sync' && changes.isd_whitelist?.newValue) {
        geofence(changes.isd_whitelist.newValue);
    } else if (namespace == 'sync' && changes.perSiteStrictMode?.newValue !== undefined) {
        perSiteStrictMode = changes.perSiteStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.globalStrictMode?.newValue !== undefined) {
        globalStrictMode = changes.globalStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.isd_all?.newValue !== undefined) {
        allowAllgeofence(changes.isd_all.newValue);
    } else if (namespace === 'sync' && 
        (changes.proxyScheme || changes.proxyHost || changes.proxyPort)) {
       // Reload all proxy settings if any changed
       loadProxySettings();

       knownSCION = {};
       knownNonSCION = {};
       policyCookie = null;
     }
})

// Changes icon depending on the extension is running or not
function updateRunningIcon(extensionRunning) {
    if (extensionRunning) {
        chrome.browserAction.setIcon({ path: "/images/scion-38.jpg" });
    } else {
        chrome.browserAction.setIcon({ path: "/images/scion-38_disabled.jpg" });
    }
}

/*--- END storage ------------------------------------------------------------*/

/*--- tabs -------------------------------------------------------------------*/

// User switches between tabs
chrome.tabs.onActivated.addListener(function (activeInfo) {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        handleTabChange(tab);
    });
});

// Update icon depending on hostname of current active tab
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    handleTabChange(tab);
});

// Displays a green/blue SCION icon depending on the current url is
// being forwarded via SCION
async function handleTabChange(tab) {
    if (tab.active && tab.url) {
        const url = new URL(tab.url);
        const databaseAdapter = await getRequestsDatabaseAdapter();
        let requests = await databaseAdapter.get({ mainDomain: url.hostname });
        var mixedContent;

        const mainDomainSCIONEnabled = requests.find(r => r.tabId === tab.id && r.domain === url.hostname && r.scionEnabled);
        requests.forEach(r => {
            if (!r.scionEnabled) {
                mixedContent = true;
            }
        });
        if (mainDomainSCIONEnabled) {
            if (mixedContent) {
                chrome.browserAction.setIcon({ path: "/images/scion-38_mixed.jpg" });
            } else {
                chrome.browserAction.setIcon({ path: "/images/scion-38_enabled.jpg" });
            }
        } else {
            chrome.browserAction.setIcon({ path: "/images/scion-38_not_available.jpg" });
        }
    }
}

/*--- requests ---------------------------------------------------------------*/

/* Request intercepting (see https://developer.chrome.com/docs/extensions/reference/api/webRequest#type-BlockingResponse) */
chrome.webRequest.onBeforeRequest.addListener(
    onBeforeRequest, { urls: ["<all_urls>"] }, ['blocking']);

chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived, { urls: ["<all_urls>"] }, ['blocking']);

chrome.webRequest.onAuthRequired.addListener(
    onAuthRequired, { urls: ["<all_urls>"] }, ['blocking']);

chrome.webRequest.onBeforeRedirect.addListener(
    onBeforeRedirect, { urls: ["<all_urls>"] });

chrome.webRequest.onErrorOccurred.addListener(
    onErrorOccurred, { urls: ["<all_urls>"] });

function onBeforeRequest(requestInfo) {

    const url = new URL(requestInfo.url);

    // Skip all weird requests...
    if (url.hostname == proxyHost) {
        console.log("<onBeforeRequest> ignoring: " + url)
        return {}
    }

    if (requestInfo.url.startsWith("chrome-extension")) {
        return {};
    }

    if (requestInfo.initiator && requestInfo.initiator.startsWith("chrome-extension")) {
        return {};
    }

    console.log("<onBeforeRequest> REQUEST URL: " + JSON.stringify(requestInfo.url));

    getRequestsDatabaseAdapter().then(databaseAdapter => {
        const requestDBEntry = {
            requestId: requestInfo.requestId,
            tabId: requestInfo.tabId,
            domain: url.hostname,
            mainDomain: requestInfo.initiator ? new URL(requestInfo.initiator).hostname : '',
        };

        // If we don't have any information about scion-enabled or not
        if (!knownNonSCION[url.hostname] && !knownSCION[url.hostname]) {
            // We can't do this in the onBeforeRedirect/onErrorOccured
            // Because these things are only done in strict mode
            // So we would loose all information for domains that are not in
            // (global) strict mode
            console.log("<DB> to scion or not to scion: ", url.hostname)

            fetch(`${proxyAddress}${proxyHostResolvePath}?${proxyHostResolveParam}=${url.hostname}`, {
                method: "GET"
            }).then(response => {
                if (response.status === 200) {
                    response.text().then(res => {
                        if (res != "") {
                            requestDBEntry.scionEnabled = true;
                            console.log("<DB> scion enabled (after resolve): ", url.hostname)
                        } else {
                            console.log("<DB> scion disabled (after resolve): ", url.hostname)
                        }
                        databaseAdapter.add(requestDBEntry, {
                            mainDomain: requestDBEntry.mainDomain,
                            scionEnabled: requestDBEntry.scionEnabled,
                            domain: requestDBEntry.domain,
                        });
                    });
                } else {
                    console.warn("<DB> Resolution error ", response.status);
                }
            }).catch((e) => {
                console.warn("<DB> Resolution failed: " + url);
                console.error(e);
            });
        } else {
            requestDBEntry.scionEnabled = !!knownSCION[url.hostname];
            console.log("<DB> scion enabled/disabled: ", requestDBEntry.scionEnabled, url.hostname)
            databaseAdapter.add(requestDBEntry);

        }
    });

    let checkDomain = url.hostname;
    if (requestInfo.initiator) {
        const mainDomain = new URL(requestInfo.initiator);
        checkDomain = mainDomain.hostname;
    }

    // Check document for strict mode
    if (globalStrictMode || perSiteStrictMode[checkDomain]) {
        if (knownNonSCION[url.hostname]) {
            console.log("<onBeforeRequest> known NON scion (strict): " + url.hostname);
            return { cancel: true };
        } else if (knownSCION[url.hostname]) {
            console.log("<onBeforeRequest> known scion (strict): " + url.hostname);
            return {};
        } else {
            console.log("<onBeforeRequest> resolve URL by redirect (strict): ", requestInfo.url)
            return { redirectUrl: `${proxyAddress}${proxyURLResolvePath}?${proxyURLResolveParam}=${requestInfo.url}` };
        }
    }

    console.log("<onBeforeRequest> assumed non scion: " + url.hostname);
    return {};
}

// Skip answers on a resolve request with a status code 500 if the host is not scion capable
function onHeadersReceived(details) {
    if (details.url.startsWith(`${proxyAddress}${proxyURLResolvePath}`) && details.statusCode >= 500) {
        console.log("<onHeadersReceived> Error: ", details.url);
        console.log(details);

        const url = new URL(details.url);
        // The actual URL that we need is in ?url=$url
        const target = url.search.split("=")[1];
        const targetUrl = new URL(target);
        knownNonSCION[targetUrl.hostname] = true;
        console.log("<onHeadersReceived> known NON scion (after resolve): ", targetUrl.hostname)

        // we do not use { cancel: true } here but redirect another time to make sure
        // the target domain is listed as block and not the skip proxy address
        return { redirectUrl: targetUrl.toString() };
    }
}

// Proxy requires the Proxy-Authorization header to be set,
// (if not it send back a Proxy-Authenticate header and triggers this function)
// the header has to contain the path policy cookie that is aquired by the first request
// and updated on setPolicy requests as there is no other way to pass the path policy into the
// Proxy for HTTPS requests (aka encrypted)
function onAuthRequired(details) {
    console.log("<onAuthRequired>")
    console.log(details)

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
        knownSCION[url.hostname] = true;
    }
}
