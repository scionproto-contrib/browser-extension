import {getSyncValues, PROXY_HOST, PROXY_PORT, PROXY_SCHEME, saveSyncValues, type SyncValueSchema} from "../shared/storage.js";
import Mode = chrome.proxy.Mode;

type ProxyConfig = {
    [PROXY_SCHEME]: SyncValueSchema[typeof PROXY_SCHEME];
    [PROXY_HOST]: SyncValueSchema[typeof PROXY_HOST];
    [PROXY_PORT]: SyncValueSchema[typeof PROXY_PORT];
} | null;

const HTTP_PROXY_SCHEME = "http"
const HTTP_PROXY_PORT = "9080";
export const HTTPS_PROXY_SCHEME = "https"
export const HTTPS_PROXY_PORT = "9443";
export const DEFAULT_PROXY_HOST = "forward-proxy.scion";

export const proxyHealthCheckPath = "/health"
export const proxyPathUsagePath = "/path-usage"

export const proxyHostResolvePath = "/resolve"
export const proxyHostResolveParam = "host"
export const proxyURLResolvePath = "/redirect"
export const proxyURLResolveParam = "url";
export const proxyPolicyPath = "/policy"

export let proxyScheme = HTTPS_PROXY_SCHEME;
export let proxyHost = DEFAULT_PROXY_HOST;
export let proxyPort = HTTPS_PROXY_PORT;
export let proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

export const WPAD_URL = `http://wpad/wpad_scion.dat`;

export async function initializeProxyHandler() {
    // Load saved configuration at startup
    const {autoProxyConfig} = await chrome.storage.sync.get({autoProxyConfig: true});
    if (autoProxyConfig) {
        await fetchAndApplyScionPAC();
    } else {
        await loadProxySettings();
    }

    chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
        if (request.action === "fetchAndApplyScionPAC") {
            await fetchAndApplyScionPAC();
            return true;
        }
    });
}

export async function loadProxySettings() {
    const items = await getSyncValues({
        [PROXY_SCHEME]: HTTPS_PROXY_SCHEME,
        [PROXY_HOST]: DEFAULT_PROXY_HOST,
        [PROXY_PORT]: HTTPS_PROXY_PORT,
    });
    proxyScheme = items[PROXY_SCHEME];
    proxyHost = items[PROXY_HOST];
    proxyPort = items[PROXY_PORT];
    proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

    await updateProxyConfiguration();
}


function parseProxyFromPAC(pacScript: string): ProxyConfig {
    // We look for the first HTTPS definition, if not found, we look for the first HTTP definition.
    const httpsProxyMatch = pacScript.match(/HTTPS\s+([^:]+):(\d+)/i);
    const httpProxyMatch = pacScript.match(/PROXY\s+([^:]+):(\d+)/i);

    if (httpsProxyMatch) {
        if (!isValidPort(httpsProxyMatch[2])) {
            console.warn("Invalid port number in PAC script");
            return null;
        }
        return {
            proxyScheme: HTTPS_PROXY_SCHEME,
            proxyHost: httpsProxyMatch[1],
            proxyPort: httpsProxyMatch[2]
        };
    } else if (httpProxyMatch) {
        if (!isValidPort(httpProxyMatch[2])) {
            console.warn("Invalid port number in PAC script");
            return null;
        }
        return {
            proxyScheme: HTTP_PROXY_SCHEME,
            proxyHost: httpProxyMatch[1],
            proxyPort: httpProxyMatch[2]
        };
    } else {
        console.warn("No valid proxy configuration found in PAC script");
    }

    return null;
}

function isValidPort(port: string) {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
}

async function fetchAndApplyScionPAC() {
    try {
        const response = await fetch(WPAD_URL);
        if (!response.ok) {
            throw new Error(`Retrieving PAC config; status: ${response.status}`);
        }
        const pacScript = await response.text();

        const proxyConfig = parseProxyFromPAC(pacScript);

        if (proxyConfig) {
            // As long as we can parse the PAC script, we assume it is correct,
            // i.e., we don't check the proxy health here.
            proxyScheme = proxyConfig.proxyScheme;
            proxyHost = proxyConfig.proxyHost;
            proxyPort = proxyConfig.proxyPort;
            proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

            await saveSyncValues({
                [PROXY_SCHEME]: proxyScheme,
                [PROXY_HOST]: proxyHost,
                [PROXY_PORT]: proxyPort,
            });
            console.log("Detected proxy configuration:", proxyAddress);

            const config = {
                mode: Mode.PAC_SCRIPT,
                pacScript: {
                    data: pacScript
                }
            };

            await chrome.proxy.settings.set({value: config, scope: 'regular'});

            console.log("SCION PAC configuration from WPAD applied");
        } else {
            throw new Error("Failed to parse PAC script");
        }
    } catch (error) {
        console.warn("Error on WPAD process, falling back to default:", error);
        await fallbackToDefaults();
    }
}

async function fallbackToDefaults() {
    const success = await tryProxyConnection(HTTPS_PROXY_SCHEME, HTTPS_PROXY_PORT);
    if (success) {
        await setProxyConfiguration(HTTPS_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT);
    } else {
        const httpSuccess = await tryProxyConnection(HTTP_PROXY_SCHEME, HTTP_PROXY_PORT)
        if (httpSuccess) {
            await setProxyConfiguration(HTTP_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTP_PROXY_PORT);
        } else {
            await setProxyConfiguration(HTTPS_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT);
            console.warn("Both HTTPS and HTTP proxy connections failed, using HTTPS as default");
        }
    }
}

async function tryProxyConnection(scheme: string, port: string) {
    const testUrl = `${scheme}://${DEFAULT_PROXY_HOST}:${port}${proxyHealthCheckPath}`;
    console.log(`Testing proxy connection to ${testUrl}`);

    try {
        const response = await fetch(testUrl, {method: 'GET'});

        if (response.ok) {
            console.log(`Successfully connected to ${scheme} proxy`);
            return true;
        } else {
            console.warn(`Failed to connect to ${scheme} proxy: status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.warn(`Error connecting to ${scheme} proxy:`, error);
        return false;
    }
}

async function setProxyConfiguration(scheme: string, host: string, port: string) {
    proxyScheme = scheme;
    proxyHost = host;
    proxyPort = port;
    proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

    await saveSyncValues({
        [PROXY_SCHEME]: proxyScheme,
        [PROXY_HOST]: proxyHost,
        [PROXY_PORT]: proxyPort,
    });
    console.log(`Using proxy configuration: ${proxyAddress}`);

    await updateProxyConfiguration();
}


// direct everything to the forward-proxy except if the target is the forward-proxy, then go direct
async function updateProxyConfiguration() {
    const config = {
        mode: Mode.PAC_SCRIPT,
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

    await chrome.proxy.settings.set({value: config, scope: 'regular'});

    console.log("Proxy configuration updated");

    const proxyConfig = await chrome.proxy.settings.get({});
    console.log(proxyConfig);
}