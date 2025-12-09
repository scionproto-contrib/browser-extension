import {proxyAddress, proxyHost, proxyHostResolveParam, proxyHostResolvePath, proxyURLResolvePath} from "./proxy_handler.js";
import {getRequestsDatabaseAdapter} from "../database.js";
import {addDnrAllowRule, addDnrBlockingRule, fetchNextDnrRuleId} from "./dnr_handler.js";
import {globalStrictMode} from "../background.js";
import {policyCookie} from "./geofence_handler.js";

let isHostnameSCION = {};

export function initializeRequestInterceptionListeners() {
    // Request intercepting (see https://developer.chrome.com/docs/extensions/reference/api/webRequest#type-BlockingResponse)
    // chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, {urls: ["<all_urls>"]});

    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, {urls: ["<all_urls>"]});

    // in manifest version 3 (MV3), the onAuthRequired is the only listener that still supports and accepts the 'blocking' extraInfoSpec
    chrome.webRequest.onAuthRequired.addListener(onAuthRequired, {urls: ["<all_urls>"]}, ['blocking']);

    chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, {urls: ["<all_urls>"]});

    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, {urls: ["<all_urls>"]});
}

export function resetKnownHostnames() {
    isHostnameSCION = {};
}

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

    getRequestsDatabaseAdapter().then(async databaseAdapter => {
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
            // console.log(`Host ${url.hostname} is known to be ${isHostnameSCION[url.hostname] ? "" : "non-"}SCION. Canceling resolve of hostname via proxy.`);
            requestDBEntry.scionEnabled = isHostnameSCION[url.hostname];
            const first = databaseAdapter.first({
                mainDomain: requestDBEntry.mainDomain,
                scionEnabled: requestDBEntry.scionEnabled,
                domain: requestDBEntry.domain,
            })
            if (first == null) {
                databaseAdapter.add(requestDBEntry, {
                    mainDomain: requestDBEntry.mainDomain,
                    scionEnabled: requestDBEntry.scionEnabled,
                    domain: requestDBEntry.domain,
                });
            } else {
                // assign block rule if it is non-scion but does not have one assigned
                if (!first.scionEnabled && first.dnrBlockRuleId === -1) {
                    const dnrBlockRuleId = await fetchNextDnrRuleId();
                    requestDBEntry.dnrBlockRuleId = dnrBlockRuleId;

                    if (globalStrictMode) {
                        await addDnrBlockingRule(url.hostname, dnrBlockRuleId).catch(err => {
                            console.warn("DNR add rule failed for", url.hostname, err);
                        });
                    }
                }

                databaseAdapter.update(first.requestId, requestDBEntry);
            }

        } else {
            console.log("DEBUG: This hostname was not registered before. Attempting to register...")

            const redirectUrl = `https://forward-proxy.scion.ethz.ch:9443${proxyURLResolvePath}?url=${requestInfo.url}`
            fetch(redirectUrl, {method: "GET"}).then(response => {
                console.log(`[onBeforeRequest]: Response for url [${redirectUrl}]:`, response);
            });
            return
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
    console.log("[onHeadersReceived]: ", details);
    if (details.url.startsWith(`${proxyAddress}${proxyURLResolvePath}`)) {
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
