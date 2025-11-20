const HTTPS_PROXY_SCHEME = "https"
const HTTP_PROXY_SCHEME = "http"
const DEFAULT_PROXY_HOST = "forward-proxy.scion";
const HTTPS_PROXY_PORT = "9443";
const HTTP_PROXY_PORT = "9080";
const proxyHealthCheckPath = "/health"

let proxyScheme = HTTPS_PROXY_SCHEME;
let proxyHost = DEFAULT_PROXY_HOST;
let proxyPort = HTTPS_PROXY_PORT;
let proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

export function loadProxySettings() {
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

export function fetchAndApplyScionPAC() {
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