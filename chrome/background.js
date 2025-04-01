// Copyright 2024 ETH Zurich, Ovgu
'use strict';

const DEFAULT_PROXY_SCHEME = "https"
const DEFAULT_PROXY_HOST = "forward-proxy.scion";
const DEFAULT_PROXY_PORT = "9443";

const proxyHostResolvePath = "/resolve"
const proxyHostResolveParam = "host"
const proxyURLResolvePath = "/redirect"
const proxyURLResolveParam = "url"
const proxyPolicyPath = "/policy"
const proxyErrorPath = "/error"
const proxyHealthCheckPath = "/health"

let proxyScheme = DEFAULT_PROXY_SCHEME;
let proxyHost =  DEFAULT_PROXY_HOST;
let proxyPort = DEFAULT_PROXY_PORT;
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
chrome.storage.sync.get({ autoProxyConfig: false }, ({ autoProxyConfig }) => {
    if (autoProxyConfig) {
        fetchAndApplyScionPAC();
    } else {
        loadProxySettings();
    }
});

function loadProxySettings() {
    chrome.storage.sync.get({
      proxyScheme: DEFAULT_PROXY_SCHEME,
      proxyHost: DEFAULT_PROXY_HOST,
      proxyPort: DEFAULT_PROXY_PORT
    }, (items) => {
      proxyScheme = items.proxyScheme;
      proxyHost = items.proxyHost;
      proxyPort = items.proxyPort;
      proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;
      
      updateProxyConfiguration();
    });
}

// TODO: we assume correct formate from the server. We may want to
// validate the PAC script, here.
function parseProxyFromPAC(pacScript) {
    const httpsProxyMatch = pacScript.match(/HTTPS\s+([^:]+):(\d+)/i);
    const httpProxyMatch = pacScript.match(/PROXY\s+([^:]+):(\d+)/i);
    
    if (httpsProxyMatch) {
      return {
        proxyScheme: "https",
        proxyHost: httpsProxyMatch[1],
        proxyPort: httpsProxyMatch[2]
      };
    } else if (httpProxyMatch) {
      return {
        proxyScheme: "http",
        proxyHost: httpProxyMatch[1],
        proxyPort: httpProxyMatch[2]
      };
    }
    
    return null;
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
          proxyScheme = proxyConfig.proxyScheme;
          proxyHost = proxyConfig.proxyHost;
          proxyPort = proxyConfig.proxyPort;
          proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;
          
          console.log("Detected proxy configuration:", proxyAddress);

          if (!checkProxyHealth(proxyAddress)) {
            // The error handling takes care of updating the proxy variables
            // and falling back to defaults
            throw new Error("Proxy health check failed");
          }

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

function checkProxyHealth(proxyAddressToCheck) {
    const proxyUrl = `${proxyAddressToCheck}${proxyHealthCheckPath}`;
    fetch(proxyUrl, {
        method: "GET",
        signal: AbortSignal.timeout(2000)
    }).then(response => {
        if (response.status === 200) {
            console.log(`Proxy ${proxyAddressToCheck} is healthy`);
            return true;
        } else {
            console.warn(`Proxy ${proxyAddressToCheck} is not healthy, status code: ${response.status}`);
            return false;
        }
    }).catch(error => {
        console.warn(`Error checking proxy ${proxyAddressToCheck} health:`, error);
        return false;
    });
}

function fallbackToDefaults() {
    proxyScheme = DEFAULT_PROXY_SCHEME;
    proxyHost = DEFAULT_PROXY_HOST;
    proxyPort =  DEFAULT_PROXY_PORT;
    proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;
    
    chrome.storage.sync.set({
        proxyScheme: proxyScheme,
        proxyHost: proxyHost,
        proxyPort: proxyPort
    }, function() {
        console.log("Falling back to default proxy configuration:", proxyAddress);
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

const errorHTML = `
<html>
<head>
    <title>Error Page</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f2f2f2;
        }
        .error-banner {
            background-color: #007BFF;
            color: #fff;
            padding: 10px;
            text-align: center;
            font-size: 40px;
        }
        .error-message {
            background-color: #fff;
            border: 1px solid #ccc;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            margin: 20px;
            padding: 20px;
            text-align: center;
            font-size: 28px;
        }
        .details-section {
          background-color: #fff;
          border: 1px solid #ccc;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          margin: 20px;
          padding: 20px;
          text-align: center;
          font-size: 20px;
      }
    </style>
</head>
<body>
    <div class="error-banner">
      The SCION extension is unable to load the website
    </div>
`;

// Proxy throws and error in CONNECT request if there is no available path
function onErrorOccurred(details) {
    console.log("<onErrorOccurred> Error: ", details.error);
    console.log(details)

    let tabId = details.tabId;
    // TODO this results in an inifite recursion in case during the fetch another error happens
    if (false && details.documentLifecycle === "active" && details.error === "net::ERR_TUNNEL_CONNECTION_FAILED") {
        console.log("resolve URL on error: ", details.url)
        fetch(`${proxyAddress}${proxyErrorPath}?${proxyURLResolveParam}=${details.url}`, {
            method: "GET"
        }).then(response => {

            if (response.status === 200) {
                console.warn("Resolution success");
                response.text().then(customErrorMessage => {

                    let trimmedMessage = customErrorMessage.replace("INTERNAL_ERROR (local): ", "");


                    const updatedErrorHTML = errorHTML + `
          <div class="error-message" id="custom-error">
            ${trimmedMessage} (Destination AS for ${details.url}).
               <div class="details-section" id="details">
              Please check your Geofencing settings or contact your IT service desk.
              </div>
          </div>
          </body>
          </html>
          `

                    // Store the updated HTML content in a data URL
                    const blob = new Blob([updatedErrorHTML], { type: 'text/html' });
                    const localErrorURL = URL.createObjectURL(blob);
                    chrome.tabs.create({ url: localErrorURL });
                });
            } else {
                console.warn("Resolution error");
                chrome.tabs.update(
                    tabId,
                    { url: chrome.runtime.getURL("error.html") });
            }
        }).catch((e) => {
            console.warn("Resolution failed");
            console.error(e);
            chrome.tabs.update(
                tabId,
                { url: chrome.runtime.getURL("error.html") });
        });
    }
}