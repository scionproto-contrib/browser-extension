import {DOMAIN, getRequests, type RequestSchema} from "../shared/storage.js";
import {proxyAddress, proxyHost, proxyURLResolveParam, proxyURLResolvePath, WPAD_URL} from "./proxy_handler.js";
import {isHostScion} from "./request_interception_handler.js";
import {normalizedHostname} from "../shared/utilities.js";
import {GlobalStrictMode, PerSiteStrictMode} from "../background.js";
import type {DeclarativeNetRequest} from "webextension-polyfill";

type ResourceType = DeclarativeNetRequest.ResourceType;
type Rule = DeclarativeNetRequest.Rule;

/*
General DNR (DeclarativeNetRequest) strategy:
 - all `main_frame` resources are forwarded to a `checking.html` page where the extension
    can asynchronously verify whether the host is SCION capable. If it is, redirect to that
    resource, otherwise show a blocking-page (cannot use the approach for sub-resources (discussed
    in the next point) as the browser fails with "ERR_CONNECTION_RESET" and additionally,
    checking.html allows for superior UI showing the user the current progress since otherwise
    the resolve-URL is visible in the browser's address bar and thus visible to the user)
 - all other sub-resources are forwarded to the `/redirect` endpoint of the proxy and then
    handled by the `onHeadersReceived` function that, based on the returned statuscode, determines
    whether the host was scion capable (to prevent future requests from going to the proxy again)
 - for all hosts known to the extension, a DNR rule with higher priority is installed to
    override the generic redirect rules mentioned above, thus preventing proxy lookup loops (a
    hypothetical lookup loop example that assumes `example.com` is SCION-capable: user enters
    `example.com`, redirected to the proxy => proxy redirects to `example.com` => again redirected
    to the proxy etc.)

Regarding safety of functions:
The distribution of DNR rule IDs relies on first fetching the currently active rules, then
searching for an unused ID and using that in a call to `chrome.declarativeNetRequest.updateDynamicRules()`.
However, due to these calls being within an async function, there can be data races between
the fetch of active rules and the addition of a rule with the discovered unused ID, thus these
actions must be wrapped with `withLock`.
 */

// generic DNR rules (the ID simultaneously represents its priority)
const SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID = 1;
const MAIN_FRAME_REDIRECT_RULE_ID = 2;
const SUBRESOURCES_REDIRECT_RULE_ID = 3;

// sufficiently high to have space for generic DNR rules (specified above)
const DOMAIN_SPECIFIC_RULES_START_ID = 10000;

const EXT_PAGE = browser.runtime.getURL('/checking.html');

// extracting the hostname from the WPAD URL, as it needs to be excluded from matching rules
// note that this might cause other resources that share the same hostname to be excluded too
const WPAD_HOSTNAME = new URL(WPAD_URL).hostname;

const MAIN_FRAME_TYPE: ResourceType[] = ["main_frame"];
const ALL_RESOURCE_TYPES: ResourceType[] = [
    "main_frame",
    "sub_frame",
    "stylesheet",
    "script",
    "image",
    "object",
    "object_subrequest",
    "xmlhttprequest",
    "xslt",
    "ping",
    "beacon",
    "xml_dtd",
    "font",
    "media",
    "websocket",
    "csp_report",
    "imageset",
    "web_manifest",
    "speculative",
    "json",
    "other",
];

/**
 * Initializes the DNR handler.
 *
 * Note that since this function is called from the service worker and these are ephemeral in MV3, this function will be called quite often (e.g. when the user opens a new tab).
 */
export async function initializeDnr() {
    console.log("Initializing DNR");

    await globalStrictModeUpdated();
}

/**
 * Function that enforces the global strict mode based on the boolean value passed in `globalStrictMode` by
 * installing DNR rules.
 */
export async function globalStrictModeUpdated() {
    if (GlobalStrictMode) {
        await withLock(async () => {
            const [allowedHostsWithId, blockedHostsWithId] = await getAllowedAndBlockedHostsWithId();

            let genericRules = [
                createMainFrameRedirectRule(),
                createSubResourcesRedirectRule(),
            ];

            let domainSpecificRules = [];
            for (const [hostname, dnrRuleId] of Object.entries(allowedHostsWithId)) {
                domainSpecificRules.push(createAllowRule(hostname, dnrRuleId));
            }
            for (const [hostname, dnrRuleId] of Object.entries(blockedHostsWithId)) {
                domainSpecificRules.push(createBlockRule(hostname, dnrRuleId));
            }

            await updateRules(genericRules, domainSpecificRules);
        });
    } else {
        // only handle perSiteStrictMode if global mode is off, otherwise global overrides them anyway
        // fallback to empty dictionary if no value was present in storage
        await perSiteStrictModeUpdated();
    }
}

/**
 * Updates the DNR rules to handle individual strict sites (which are based on the `perSiteStrictMode` parameter).
 */
export async function perSiteStrictModeUpdated() {
    // if globalStrictMode is on, do not change any DNR rules
    if (GlobalStrictMode) return;

    await withLock(async () => {
        const [allowedHostsWithId, blockedHostsWithId] = await getAllowedAndBlockedHostsWithId();

        const strictHosts: string[] = Object.entries(PerSiteStrictMode)
            .filter(([, isStrict]) => isStrict)
            .map(([host]) => normalizedHostname(host));

        // adding rules that block each of the hosts directly
        let domainSpecificRules: Rule[] = [];
        for (const strictHost of strictHosts) {
            // if the extension has info about the host, add the appropriate DNR rule, otherwise perform a lookup
            if (Object.keys(blockedHostsWithId).includes(strictHost)) domainSpecificRules.push(createBlockRule(strictHost, blockedHostsWithId[strictHost]));
            else if (Object.keys(allowedHostsWithId).includes(strictHost)) domainSpecificRules.push(createAllowRule(strictHost, allowedHostsWithId[strictHost]));
            else {
                // using chrome.tabs.TAB_ID_NONE as the tab id, as no tab can be associated with this request
                // isHostScion already adds the appropriate DNR rules based on the lookup result (including creating the DB entry for the host)
                await isHostScion(strictHost, strictHost, browser.tabs.TAB_ID_NONE, true);
            }
        }

        // the individual rules above are insufficient, as a site marked as 'strict' can invoke other sub-resources that
        // should be blocked, but might have a different hostname and thus might not have a matching rule
        // thus, a redirect rule is needed that redirects all requests whose initiator is marked as 'strict'
        let genericRules: Rule[] = [];
        if (strictHosts.length > 0) {
            const subresourceInitiatorRule = createSubResourcesInitiatorRedirectRule(strictHosts);
            genericRules.push(subresourceInitiatorRule);
        }

        await updateRules(genericRules, domainSpecificRules);
    });
}

/**
 * When the proxy settings were changed, this function must be executed as some DNR rules rely on
 * the {@link proxyAddress} and therefore need to be updated.
 */
export async function updateProxySettingsInDnrRules() {
    const currentRules = await browser.declarativeNetRequest.getDynamicRules();
    let hasSRR = false; // sub-resources redirect rule
    let hasSIRR = false; // sub-resources initiator redirect rule
    let initiatorRuleBlockedInitiators: string[] = [];
    for (const rule of currentRules) {
        if (rule.id === SUBRESOURCES_REDIRECT_RULE_ID) {
            hasSRR = true;
            // both rules found, no need to search further
            if (hasSIRR) break;
        }
        if (rule.id === SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID) {
            initiatorRuleBlockedInitiators = rule.condition.initiatorDomains!;
            hasSIRR = true;

            // both rules found, no need to search further
            if (hasSRR) break;
        }
    }

    if (!hasSRR && !hasSIRR) return;

    let toAdd = [];
    let toRemoveIds = [];
    if (hasSRR) {
        toAdd.push(createSubResourcesRedirectRule());
        toRemoveIds.push(SUBRESOURCES_REDIRECT_RULE_ID);
    }
    if (hasSIRR) {
        toAdd.push(createSubResourcesInitiatorRedirectRule(initiatorRuleBlockedInitiators));
        toRemoveIds.push(SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID);
    }

    await browser.declarativeNetRequest.updateDynamicRules({addRules: toAdd, removeRuleIds: toRemoveIds});
}

/**
 * Based on `scionEnabled` creates a DNR allow or block rule for the `host`.
 */
export async function addDnrRule(host: string, scionEnabled: boolean, alreadyHasLock: boolean) {
    const run = async () => {
        const id = (await getNFreeIds(1))[0];

        // if a rule for the `host` already exists, do not add another rule
        const currentRules = await browser.declarativeNetRequest.getDynamicRules();
        const currentUrlFilters = currentRules.map(rule => rule.condition.urlFilter);
        if (currentUrlFilters.includes(urlFilterFromHost(host))) return;

        const rule = scionEnabled ? createAllowRule(host, id) : createBlockRule(host, id);
        await browser.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []})
    };
    if (alreadyHasLock) {
        await run();
        return;
    }
    await withLock(run);
}

function createBlockRule(host: string, id: number): Rule {
    return {
        id: id,
        priority: 100,
        action: {type: 'block'},
        condition: {
            urlFilter: urlFilterFromHost(host),
            resourceTypes: ALL_RESOURCE_TYPES
        }
    };
}

function createAllowRule(host: string, id: number): Rule {
    return {
        id: id,
        priority: 101,
        action: {type: 'allow'},
        condition: {
            urlFilter: urlFilterFromHost(host),
            resourceTypes: ALL_RESOURCE_TYPES
        }
    }
}

/**
 * Returns the string for the `urlFilter` parameter of a DNR rule.
 */
function urlFilterFromHost(host: string) {
    // in the simplified pattern matching syntax used by `urlFilter`, the '|' pipe denotes the start of the url, allowing for EXACT url matching,
    // something that the `requestDomains` property cannot do (e.g. `requestDomains: ["example.com"]` will also match requests to `a.example.com`)
    return `|http*://${host}/`;
}

/**
 * Returns a DNR rule that redirects all `main_frame` requests to the `checking.html` page for a synchronous blocking lookup.
 */
function createMainFrameRedirectRule(): Rule {
    return {
        id: MAIN_FRAME_REDIRECT_RULE_ID,
        priority: MAIN_FRAME_REDIRECT_RULE_ID,
        action: {
            type: 'redirect',
            redirect: {
                // match entire URL and append it to a hash (separator character expected by checking.js)
                regexSubstitution: EXT_PAGE + '#\\0',
            },
        },
        condition: {
            regexFilter: '^.+$', // match any URL
            resourceTypes: MAIN_FRAME_TYPE
        }
    };
}

/**
 * Returns a DNR rule that redirects all sub-resources to the proxy `proxyURLResolvePath` endpoint.
 */
function createSubResourcesRedirectRule(): Rule {
    return {
        id: SUBRESOURCES_REDIRECT_RULE_ID,
        priority: SUBRESOURCES_REDIRECT_RULE_ID,
        action: {
            type: 'redirect',
            redirect: {
                // pass entire URL to the proxy for lookup
                regexSubstitution: `${proxyAddress}${proxyURLResolvePath}?${proxyURLResolveParam}=\\0`,
            },
        },
        condition: {
            regexFilter: '^.+$', // match any URL
            excludedResourceTypes: MAIN_FRAME_TYPE,
            // exclude requests from the proxy to prevent lookup-loops
            excludedRequestDomains: [
                proxyHost,
                WPAD_HOSTNAME,
            ],
        },
    };
}

/**
 * Returns a DNR rule that redirects all sub-resources whose initiator is in `blockedInitiators` to the `proxyURLResolvePath` endpoint.
 */
function createSubResourcesInitiatorRedirectRule(blockedInitiators: string[]): Rule {
    return {
        id: SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID,
        priority: SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID,
        action: {
            type: 'redirect',
            redirect: {
                // pass entire URL to the proxy for lookup
                regexSubstitution: `${proxyAddress}${proxyURLResolvePath}?${proxyURLResolveParam}=\\0`,
            },
        },
        condition: {
            regexFilter: '^.+$', // match any URL
            excludedResourceTypes: MAIN_FRAME_TYPE,
            initiatorDomains: blockedInitiators,
            // exclude requests from the proxy to prevent lookup-loops
            excludedRequestDomains: [
                proxyHost,
                WPAD_HOSTNAME,
            ],
        }
    }
}

/**
 * Returns a tuple containing two maps, the first containing a mapping from scion-hostnames to their id,
 * the second containing a mapping from non-scion-hostnames to their id.
 *
 * Note that this function is unsafe and must be wrapped with `withLock`.
 */
async function getAllowedAndBlockedHostsWithId() {
    const requests: RequestSchema[] = await getRequests();
    let allowedHostsWithId: Record<string, number> = {};
    let blockedHostsWithId: Record<string, number> = {};
    const freeIds: number[] = await getNFreeIds(requests.length);

    let i: number = 0;
    for (const request of requests) {
        if (request.scionEnabled) allowedHostsWithId[request[DOMAIN]] = freeIds[i];
        else blockedHostsWithId[request[DOMAIN]] = freeIds[i];
        i++;
    }

    return [allowedHostsWithId, blockedHostsWithId];
}

/**
 * Returns `n` different IDs that are currently not in use by any DNR rule.
 *
 * Note that this function is unsafe and must be wrapped with `withLock`.
 */
async function getNFreeIds(n: number): Promise<number[]> {
    const currentRules: Rule[] = await browser.declarativeNetRequest.getDynamicRules();
    const usedIds = new Set(currentRules.map(rule => rule.id));
    const idList = new Set(Array.from({length: n + usedIds.size}, (_, i) => i + DOMAIN_SPECIFIC_RULES_START_ID));
    return Array.from(idList.difference(usedIds));
}

/**
 * Updates the DNR rules with a single call to `chrome.declarativeNetRequest.updateDynamicRules` such that after execution of this function, only
 * `targetGenericRules` and `targetDomainSpecificRules` are active.
 *
 * @param targetGenericRules is an array of generic (custom defined) rules (such as `createMainFrameRedirectRule`) that should be active from this point onward.
 * @param targetDomainSpecificRules is an array of domain specific rules (created by `createBlockRule` and `createAllowRule`) that should be active from this point onward.
 */
async function updateRules(targetGenericRules: Rule[], targetDomainSpecificRules: Rule[]) {
    const currentRules = await browser.declarativeNetRequest.getDynamicRules();
    let currentGenericRules = [];
    let currentDomainSpecificRules = [];
    for (const currentRule of currentRules) {
        if (currentRule.id < DOMAIN_SPECIFIC_RULES_START_ID) currentGenericRules.push(currentRule);
        else currentDomainSpecificRules.push(currentRule);
    }

    const genericRulesToAdd = targetGenericRules.filter(rule => !currentGenericRules.includes(rule));
    const genericRulesToRemove = currentGenericRules.filter(rule => !targetGenericRules.includes(rule));

    const currentDsrHosts = currentDomainSpecificRules.map(rule => rule.condition.urlFilter);
    const targetDsrHosts = targetDomainSpecificRules.map(rule => rule.condition.urlFilter);
    const domainSpecificRulesToAdd = targetDomainSpecificRules.filter(rule => !currentDsrHosts.includes(rule.condition.urlFilter));
    const domainSpecificRulesToRemove = currentDomainSpecificRules.filter(rule => !targetDsrHosts.includes(rule.condition.urlFilter));

    const rulesToAdd = genericRulesToAdd.concat(domainSpecificRulesToAdd);
    const rulesToRemoveIds = genericRulesToRemove.concat(domainSpecificRulesToRemove).map(rule => rule.id);
    await browser.declarativeNetRequest.updateDynamicRules({addRules: rulesToAdd, removeRuleIds: rulesToRemoveIds});
}

/**
 * Lock to prevent data races when generating DNR rule IDs since access to `chrome.storage` is async.
 */
let idLock = Promise.resolve();

function withLock(fn: (() => Promise<void>)) {
    // chain the new work onto the previous one
    const p = idLock.then(fn, fn);
    // ensure errors don’t break the chain forever
    idLock = p.catch(() => {
    });
    return p;
}