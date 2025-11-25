// Copyright 2024 ETH Zurich, Ovgu
'use strict';

// import {fetchAndApplyScionPAC, loadProxySettings, proxyAddress, proxyHost} from "./background_helpers/pac_handler.js";
// import {allowAllgeofence, geofence} from "./background_helpers/geofence_handler.js";
import {getStorageValue, saveStorageValue} from "./shared/storage.js";
import {getRequestsDatabaseAdapter} from "./database.js";
import {addDnrBlockingRule, fetchNextDnrRuleId, initializeDnr} from "./background_helpers/dnr_handler.js";


const proxyHostResolvePath = "/resolve"
const proxyHostResolveParam = "host"
const proxyURLResolvePath = "/redirect"
const proxyURLResolveParam = "url"
const proxyHealthCheckPath = "/health"
const proxyPolicyPath = "/policy"

const GLOBAL_STRICT_MODE = "globalStrictMode"

const HTTPS_PROXY_SCHEME = "https"
const HTTP_PROXY_SCHEME = "http"
const DEFAULT_PROXY_HOST = "forward-proxy.scion.ethz.ch";
const HTTPS_PROXY_PORT = "9443";
const HTTP_PROXY_PORT = "9080";
let proxyScheme = HTTPS_PROXY_SCHEME;
let proxyHost =  DEFAULT_PROXY_HOST;
let proxyPort = HTTPS_PROXY_PORT;
let proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

/** Background State */
let globalStrictMode = false;
let perSiteStrictMode = {};
let isHostnameSCION = {};
let policyCookie = null

/*--- setup ------------------------------------------------------------------*/

// TODO: if there are some race conditions, add a startup
// function that is called manually after all scripts are loaded
// Let's later move to something that allows using imports and
// maybe even typescript, e.g. https://github.com/abhijithvijayan/web-extension-starter

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

function loadProxySettings() {
    chrome.storage.sync.get({
        proxyScheme: HTTPS_PROXY_SCHEME,
        proxyHost: DEFAULT_PROXY_HOST,
        proxyPort: HTTPS_PROXY_PORT
    }, (items) => {
        proxyScheme = items.proxyScheme;
        proxyHost = items.proxyHost;
        proxyPort = items.proxyPort;
        proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

        updateProxyConfiguration();
    });
}


function parseProxyFromPAC(pacScript) {
    // We look for the first HTTPS definition, if not found, we look for the first HTTP definition.
    const httpsProxyMatch = pacScript.match(/HTTPS\s+([^:]+):(\d+)/i);
    const httpProxyMatch = pacScript.match(/PROXY\s+([^:]+):(\d+)/i);

    if (httpsProxyMatch) {
        if (!isValidPort(httpsProxyMatch[2])) {
            console.warn("Invalid port number in PAC script");
            return null;
        }
        return {
            proxyScheme: "https",
            proxyHost: httpsProxyMatch[1],
            proxyPort: httpsProxyMatch[2]
        };
    } else if (httpProxyMatch) {
        if (!isValidPort(httpProxyMatch[2])) {
            console.warn("Invalid port number in PAC script");
            return null;
        }
        return {
            proxyScheme: "http",
            proxyHost: httpProxyMatch[1],
            proxyPort: httpProxyMatch[2]
        };
    } else {
        console.warn("No valid proxy configuration found in PAC script");
    }

    return null;
}

function isValidPort(port) {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
}

function fetchAndApplyScionPAC() {
    fetch(`http://wpad/wpad_scion.dat`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Retrieving PAC config; status: ${response.status}`);
            }
            return response.text();
        })
        .then(pacScript => {
            const proxyConfig = parseProxyFromPAC(pacScript);

            if (proxyConfig) {
                // As long as we can parse the PAC script, we assume it is correct,
                // i.e., we don't check the proxy health here.
                proxyScheme = proxyConfig.proxyScheme;
                proxyHost = proxyConfig.proxyHost;
                proxyPort = proxyConfig.proxyPort;
                proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

                chrome.storage.sync.set({
                    proxyScheme: proxyScheme,
                    proxyHost: proxyHost,
                    proxyPort: proxyPort
                }, function() {
                    console.log("Detected proxy configuration:", proxyAddress);
                });

                const config = {
                    mode: "pac_script",
                    pacScript: {
                        data: pacScript
                    }
                };

                chrome.proxy.settings.set({ value: config, scope: 'regular' }, function() {
                    console.log("SCION PAC configuration from WPAD applied");
                });
            } else{
                throw new Error("Failed to parse PAC script");
            }

        })
        .catch(error => {
            console.warn("Error on WPAD process, falling back to default:", error);
            fallbackToDefaults();
        });
}

function fallbackToDefaults() {
    tryProxyConnection(HTTPS_PROXY_SCHEME, HTTPS_PROXY_PORT).then(success => {
        if (success) {
            setProxyConfiguration(HTTPS_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT);
        } else {
            tryProxyConnection(HTTP_PROXY_SCHEME, HTTP_PROXY_PORT).then(success => {
                if (success) {
                    setProxyConfiguration(HTTP_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTP_PROXY_PORT);
                } else {
                    setProxyConfiguration(HTTPS_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT);
                    console.warn("Both HTTPS and HTTP proxy connections failed, using HTTPS as default");
                }
            });
        }
    });
}

function tryProxyConnection(scheme, port) {
    return new Promise(resolve => {
        const testUrl = `${scheme}://${DEFAULT_PROXY_HOST}:${port}${proxyHealthCheckPath}`;
        console.log(`Testing proxy connection to ${testUrl}`);

        fetch(testUrl, { method: 'GET' })
            .then(response => {
                if (response.ok) {
                    console.log(`Successfully connected to ${scheme} proxy`);
                    resolve(true);
                } else {
                    console.warn(`Failed to connect to ${scheme} proxy: status ${response.status}`);
                    resolve(false);
                }
            })
            .catch(error => {
                console.warn(`Error connecting to ${scheme} proxy:`, error);
                resolve(false);
            });
    });
}

function setProxyConfiguration(scheme, host, port) {
    proxyScheme = scheme;
    proxyHost = host;
    proxyPort = port;
    proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

    chrome.storage.sync.set({
        proxyScheme: proxyScheme,
        proxyHost: proxyHost,
        proxyPort: proxyPort
    }, function() {
        console.log(`Using proxy configuration: ${proxyAddress}`);
    });

    updateProxyConfiguration();
}


// direct everything to the forward-proxy except if the target is the forward-proxy, then go direct
function updateProxyConfiguration() {
    const config = {
        mode: "pac_script",
        pacScript: {
            data:
                "function FindProxyForURL(url, host) {\n" +
                `    if (isPlainHostName(host) || dnsDomainIs(host, "${proxyHost}")) {\n` +
                `        return "DIRECT"\n` +
                `    } else {\n` +
                `       return '${proxyScheme === "https" ? "HTTPS" : "PROXY"} ${proxyHost}:${proxyPort}';\n` +
                `    }\n` +
                "}",
        }
    };

    chrome.proxy.settings.set({ value: config, scope: 'regular' }, function() {
        console.log("Proxy configuration updated");
        chrome.proxy.settings.get({}, function(config) {
            console.log(config);
        });
    });
}

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

function allowAllgeofence(allowAll) {
    console.log("allowAllgeofence: ", allowAll)

    if (allowAll) {
        let whitelist = new Array()
        whitelist.push("+")
        setPolicy(whitelist)
        return
    }

    getStorageValue('isd_whitelist').then((isdSet) => {
        console.log(isdSet)
        geofence(isdSet);
    });
}

function geofence(isdList) {
    console.log("geofence: ", isdList)

    let whitelist = new Array()
    for (const isd of isdList) {
        whitelist.push("+ " + isd);
    }
    whitelist.push("-") // deny everything else
    setPolicy(whitelist)
}

// A couple of things happend on a policy change:
// 1. all cookies and cached proxy authorization credentials are deleted
// 2. the Skip proxy is updated with the new policy
// 3. the path policy cookie is globally stored and will be used as proxy authorization from now on
function setPolicy(policy) {
    let sendSetPolicyRequest = () => {
        var req = new XMLHttpRequest();
        req.open("PUT", `${proxyAddress}${proxyPolicyPath}`, true);
        req.setRequestHeader('Content-type', 'application/json; charset=utf-8');

        req.onreadystatechange = function () {
            if (req.readyState != XMLHttpRequest.DONE) {
                return
            }

            // The fetch operation is complete. This could mean that either the data transfer has been completed successfully or failed.
            console.log("response code to setPolicy:" + req.status);
            console.log("set policy: ", JSON.stringify(policy))

            if (req.status != 200) {
                console.error("Error setting policy: ", req.status)
                return
            }

            chrome.cookies.getAll({ name: "caddy-scion-forward-proxy" }, function (cookies) {
                console.log("all cookies: ", cookies)
                cookies = cookies.filter((c) => c.domain == proxyHost)
                if (cookies.length > 1) {
                    console.log("expected at most one cookie")
                    for (const c of cookies) {
                        console.log(c.name, c.value, c.domain)
                    }
                }

                if (cookies.length > 0) {
                    policyCookie = cookies[0]
                    console.log("new path policy cookie: ", cookies[0])

                    // when we set the cookie before (function below), the cookie
                    // is set with ".forward-proxy.scion" as domain (probably since we remove the hostOnly [because of the API]).
                    // The incoming cookie is set with "forward-proxy.scion" as domain.
                    // Since it is convoluted to remove one of the cookies, we just set the cookie again
                    // to avoid inconsistencies between the two of them. Otherwise, calls to /path-usage (which carry the cookie)
                    // have been observer to yield incorrect information.

                    // we have to remove some fields that are not allowed to be set
                    // by the API
                    delete policyCookie["hostOnly"];
                    delete policyCookie["session"];
                    policyCookie.url = `${proxyScheme}://${proxyHost}`;
                    chrome.cookies.set(policyCookie)
                }
            })
        };

        req.send(JSON.stringify(policy));
    }

    // this not only clears all cookies but also the proxy auth credentials
    chrome.browsingData.remove({
        "origins": [
            `${proxyScheme}://${proxyHost}`
        ] }, { "cookies": true }, () => {
        // as we have just removed all cookie we have to readd it
        if (policyCookie != null) {

            chrome.cookies.set(policyCookie, () => {
                chrome.cookies.get({
                    url: policyCookie.url,
                    name: policyCookie.name
                }, (resultCookie) => {
                    console.log("Stored cookie:", resultCookie);
                });

                sendSetPolicyRequest()
            })
        } else {
            sendSetPolicyRequest()
        }
    })
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
