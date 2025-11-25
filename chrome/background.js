// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {fetchAndApplyScionPAC, loadProxySettings, proxyAddress, proxyHost, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence} from "./background_helpers/geofence_handler.js";
import {getStorageValue, saveStorageValue} from "./shared/storage.js";
import {getRequestsDatabaseAdapter} from "./database.js";
import {addDnrBlockingRule, fetchNextDnrRuleId, initializeDnr} from "./background_helpers/dnr_handler.js";


const GLOBAL_STRICT_MODE = "globalStrictMode"

/** Background State */
let globalStrictMode = false;
let perSiteStrictMode = {};
let isHostnameSCION = {};
let policyCookie = null

/*--- setup ------------------------------------------------------------------*/

getStorageValue(GLOBAL_STRICT_MODE).then( async(syncGlobalStrictMode) => {
    console.log("globalStrictMode: value in sync storage is set to", syncGlobalStrictMode);
    if (!syncGlobalStrictMode) {
        console.log("globalStrictMode: thus setting globalStrictMode to", globalStrictMode);
        await saveStorageValue(GLOBAL_STRICT_MODE, globalStrictMode);
    } else {
        globalStrictMode = syncGlobalStrictMode;
    }

    await initializeDnr(globalStrictMode);
})

getStorageValue('perSiteStrictMode').then((val) => {
    perSiteStrictMode = val || {}; // Here we may get undefined which is bad
});
// Do icon setup etc at startup
getStorageValue('extension_running').then(extensionRunning => {
    updateRunningIcon(extensionRunning);
});


/*--- PAC --------------------------------------------------------------------*/
// Load saved configuration at startup
chrome.storage.sync.get({ autoProxyConfig: true }, ({ autoProxyConfig }) => {
    if (autoProxyConfig) {
        fetchAndApplyScionPAC();
    } else {
        loadProxySettings();
    }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
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
        geofence(changes.isd_whitelist.newValue, policyCookie);
    } else if (namespace == 'sync' && changes.perSiteStrictMode?.newValue !== undefined) {
        perSiteStrictMode = changes.perSiteStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.globalStrictMode?.newValue !== undefined) {
        globalStrictMode = changes.globalStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.isd_all?.newValue !== undefined) {
        allowAllgeofence(changes.isd_all.newValue, policyCookie);
    } else if (namespace === 'sync' && (changes.proxyScheme || changes.proxyHost || changes.proxyPort)) {
        // Reload all proxy settings if any changed
        loadProxySettings();

        isHostnameSCION = {}
        policyCookie = null;
    }
})

// Changes icon depending on the extension is running or not
function updateRunningIcon(extensionRunning) {
    if (extensionRunning) {
        chrome.action.setIcon({ path: "/images/scion-38.jpg" });
    } else {
        chrome.action.setIcon({ path: "/images/scion-38_disabled.jpg" });
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
        let mixedContent;

        const mainDomainSCIONEnabled = requests.find(r => r.tabId === tab.id && r.domain === url.hostname && r.scionEnabled);
        requests.forEach(r => {
            if (!r.scionEnabled) {
                mixedContent = true;
            }
        });
        if (mainDomainSCIONEnabled) {
            if (mixedContent) {
                await chrome.action.setIcon({path: "/images/scion-38_mixed.jpg"});
            } else {
                await chrome.action.setIcon({path: "/images/scion-38_enabled.jpg"});
            }
        } else {
            await chrome.action.setIcon({path: "/images/scion-38_not_available.jpg"});
        }
    }
}

/*--- requests ---------------------------------------------------------------*/

/* Request intercepting (see https://developer.chrome.com/docs/extensions/reference/api/webRequest#type-BlockingResponse) */
chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] });

chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls: ["<all_urls>"] });

// in manifest version 3 (MV3), the onAuthRequired is the only listener that still supports and accepts the 'blocking' extraInfoSpec
chrome.webRequest.onAuthRequired.addListener(onAuthRequired, { urls: ["<all_urls>"] }, ['blocking']);

chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, { urls: ["<all_urls>"] });

chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, { urls: ["<all_urls>"] });

function onBeforeRequest(requestInfo) {

    const url = new URL(requestInfo.url);

    // Skip all weird requests...
    if (url.hostname == proxyHost) {
        console.log("<onBeforeRequest> ignoring: " + url)
        return {}
    }

    if (requestInfo.url.startsWith("chrome-extension")) return {};

    if (requestInfo.initiator && requestInfo.initiator.startsWith("chrome-extension")) return {};

    console.log("<onBeforeRequest> REQUEST URL: " + JSON.stringify(requestInfo.url));

    getRequestsDatabaseAdapter().then(databaseAdapter => {
        let mainDomain;
        if (requestInfo.type === "main_frame") mainDomain = url.hostname;
        else if (requestInfo.initiator) mainDomain = new URL(requestInfo.initiator).hostname;
        else mainDomain = '';

        const requestDBEntry = {
            requestId: requestInfo.requestId,
            tabId: requestInfo.tabId,
            domain: url.hostname,
            mainDomain: mainDomain,
            scionEnabled: false,
            dnrBlockRuleId: -1, // set it to -1 by default (stays -1 for scion-enabled domains, otherwise gets assigned a proper rule id)
        };

        // If we don't have any information about scion-enabled or not
        if (url.hostname in isHostnameSCION) {
            console.log(`Host ${url.hostname} is known to be ${isHostnameSCION[url.hostname] ? "" : "non-"}SCION. Canceling resolve of hostname via proxy.`);
            requestDBEntry.scionEnabled = isHostnameSCION[url.hostname];
            databaseAdapter.add(requestDBEntry, {
                mainDomain: requestDBEntry.mainDomain,
                scionEnabled: requestDBEntry.scionEnabled,
                domain: requestDBEntry.domain,
            });
        } else {
            console.log("DEBUG: This hostname was not registered before. Attempting to register...")

            const fetchUrl = `${proxyAddress}${proxyHostResolvePath}?${proxyHostResolveParam}=${url.hostname}`
            fetch(fetchUrl, {method: "GET"}).then(response => {
                if (response.status === 200) {
                    response.text().then(async res => {
                        if (res != "") {
                            requestDBEntry.scionEnabled = true;
                            isHostnameSCION[url.hostname] = true;
                            console.log("<DB> scion enabled (after resolve): ", url.hostname)
                        } else {
                            requestDBEntry.scionEnabled = false;
                            isHostnameSCION[url.hostname] = false;
                            console.log("<DB> scion disabled (after resolve): ", url.hostname)

                            // DNR way of blocking this host in further lookups
                            const dnrBlockRuleId = await fetchNextDnrRuleId();
                            requestDBEntry.dnrBlockRuleId = dnrBlockRuleId;
                            // only add a DNR rule if that page should also be blocked
                            // TODO: expand condition to also check for perPageStrictMode
                            if (globalStrictMode) {
                                await addDnrBlockingRule(url.hostname, dnrBlockRuleId).catch(err => {
                                    console.warn("DNR add rule failed for", url.hostname, err);
                                });
                            }
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
                console.warn("<DB> Resolution failed: " + fetchUrl);
                console.error(e);
            });
        }
    });
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
        isHostnameSCION[targetUrl.hostname] = true;
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
    console.log("<onErrorOccurred>", details);
}
