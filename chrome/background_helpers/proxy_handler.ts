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
    const candidateDomains = await discoverSearchDomainCandidates();

    const candidateHosts = candidateDomains.map(domain => `${DEFAULT_PROXY_HOST}.${domain}`);
    candidateHosts.push(DEFAULT_PROXY_HOST);

    for (const host of candidateHosts) {
        if (await tryProxyConnection(HTTPS_PROXY_SCHEME, HTTPS_PROXY_PORT, host)) {
            await setProxyConfiguration(HTTPS_PROXY_SCHEME, host, HTTPS_PROXY_PORT);
            return;
        }
    }

    for (const host of candidateHosts) {
        if (await tryProxyConnection(HTTP_PROXY_SCHEME, HTTP_PROXY_PORT, host)) {
            await setProxyConfiguration(HTTP_PROXY_SCHEME, host, HTTP_PROXY_PORT);
            return;
        }
    }

    // Nothing reachable, default to HTTPS with bare host
    await setProxyConfiguration(HTTPS_PROXY_SCHEME, DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT);
    console.warn("All proxy connection attempts failed, using HTTPS default");
}

// Maximum number of domain suffix levels to try from the PTR-derived FQDN.
// This bounds the number of proxy connection attempts to prevent abuse from
// crafted/misconfigured PTR records with deeply nested labels.
// Real-world search domains are rarely deeper than 3 labels (e.g., inf.ethz.ch).
const MAX_SEARCH_DOMAIN_CANDIDATES = 3;

/**
 * Builds the PTR query name for reverse DNS lookup.
 * Supports both IPv4 (in-addr.arpa) and IPv6 (ip6.arpa) addresses.
 *
 * Returns the PTR query string or null if the IP format is unrecognized.
 */
function buildPtrQuery(ip: string): string | null {
    // IPv4: e.g., "203.0.113.1" → "1.113.0.203.in-addr.arpa."
    const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        return `${ipv4Match[4]}.${ipv4Match[3]}.${ipv4Match[2]}.${ipv4Match[1]}.in-addr.arpa.`;
    }

    // IPv6: e.g., "2001:db8::1" → each nibble reversed, dot-separated, under ip6.arpa.
    if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":")) {
        const expanded = expandIPv6(ip);
        if (!expanded) return null;
        const nibbles = expanded.split("").reverse().join(".");
        return `${nibbles}.ip6.arpa.`;
    }

    return null;
}

/**
 * Expands an IPv6 address to its full 32-nibble hex representation (no colons).
 * Handles :: shorthand expansion. Returns null if the format is invalid.
 *
 * Example: "2001:db8::1" → "20010db8000000000000000000000001"
 */
function expandIPv6(ip: string): string | null {
    const halves = ip.split("::");
    if (halves.length > 2) return null; // at most one "::" allowed

    const expandGroup = (group: string): string[] =>
        group === "" ? [] : group.split(":");

    const left = expandGroup(halves[0]);
    const right = halves.length === 2 ? expandGroup(halves[1]) : [];
    const missingGroups = 8 - left.length - right.length;

    if (halves.length === 2) {
        if (missingGroups < 0) return null;
    } else {
        if (left.length !== 8) return null;
    }

    const allGroups = [
        ...left,
        ...Array(Math.max(0, missingGroups)).fill("0"),
        ...right,
    ];

    if (allGroups.length !== 8) return null;

    // Pad each group to 4 hex digits and validate
    const padded = allGroups.map(g => {
        if (g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) return null;
        return g.padStart(4, "0");
    });
    if (padded.some(g => g === null)) return null;

    return padded.join("").toLowerCase();
}

const CLOUDFLARE_IPV4 = "1.1.1.1";
const CLOUDFLARE_IPV6 = "[2606:4700:4700::1111]";
const CLOUDFLARE_TRACE_IPV4 = `https://${CLOUDFLARE_IPV4}/cdn-cgi/trace`;
const CLOUDFLARE_TRACE_IPV6 = `https://${CLOUDFLARE_IPV6}/cdn-cgi/trace`;

/**
 * Fetches the client's public IP using Cloudflare's trace endpoint.
 * Tries the IPv6 endpoint first, then falls back to IPv4.
 *
 * Returns the IP address and the reachable Cloudflare host, or null if both attempts fail.
 */
async function fetchPublicIp(): Promise<{ ip: string; cloudflareHost: string } | null> {
    const endpoints = [
        {url: CLOUDFLARE_TRACE_IPV6, host: CLOUDFLARE_IPV6},
        {url: CLOUDFLARE_TRACE_IPV4, host: CLOUDFLARE_IPV4},
    ];
    for (const {url, host} of endpoints) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const text = await response.text();
            const match = text.match(/^ip=(.+)$/m);
            if (match) return {ip: match[1].trim(), cloudflareHost: host};
        } catch {
            // Connection failed try next
        }
    }
    return null;
}

/**
 * Discovers candidate search domains using Cloudflare's public APIs:
 * 1. Fetches the client's public IP (IPv4 or IPv6) from Cloudflare's trace endpoint
 * 2. Performs a reverse DNS (PTR) lookup via Cloudflare's DoH endpoint
 * 3. Generates candidate search domains by progressively stripping labels from
 *    the FQDN (most specific first), capped at {@link MAX_SEARCH_DOMAIN_CANDIDATES}
 *
 * Returns an empty array if discovery fails at any step.
 */
async function discoverSearchDomainCandidates(): Promise<string[]> {
    try {
        const result = await fetchPublicIp();
        if (!result) {
            console.warn("Search domain discovery: could not determine public IP");
            return [];
        }
        const {ip, cloudflareHost} = result;

        const ptrQuery = buildPtrQuery(ip);
        if (!ptrQuery) {
            console.warn(`Search domain discovery: unrecognized IP format (${ip}), skipping`);
            return [];
        }
        const dohUrl = `https://${cloudflareHost}/dns-query?name=${encodeURIComponent(ptrQuery)}&type=PTR`;

        const dohResponse = await fetch(dohUrl, {
            headers: {"accept": "application/dns-json"},
        });
        if (!dohResponse.ok) {
            console.warn("Search domain discovery: DoH PTR lookup failed");
            return [];
        }
        const dohData = await dohResponse.json() as { Answer?: { data: string }[] };
        if (!dohData.Answer || dohData.Answer.length === 0) {
            console.warn("Search domain discovery: no PTR record found");
            return [];
        }

        const fqdn = dohData.Answer[0].data.replace(/\.$/, "");
        const labels = fqdn.split(".");
        if (labels.length < 3) {
            console.warn(`Search domain discovery: FQDN too short for search domain extraction (${fqdn})`);
            return [];
        }

        const candidates: string[] = [];
        for (let i = 1; i < labels.length - 1 && candidates.length < MAX_SEARCH_DOMAIN_CANDIDATES; i++) {
            candidates.push(labels.slice(i).join("."));
        }

        console.log(`Search domain discovery: resolved ${ip} → ${fqdn}, candidates: [${candidates.join(", ")}]`);
        return candidates;
    } catch (error) {
        console.warn("Search domain discovery failed:", error);
        return [];
    }
}

async function tryProxyConnection(scheme: string, port: string, host: string = DEFAULT_PROXY_HOST) {
    const testUrl = `${scheme}://${host}:${port}${proxyHealthCheckPath}`;
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