import {getStorageValue, saveStorageValue} from "../shared/storage.js";
import {getRequestsDatabaseAdapter} from "../database.js";
import {proxyAddress, proxyHost, proxyURLResolveParam, proxyURLResolvePath, WPAD_URL} from "./proxy_handler.js";
import {isHostScion} from "./request_interception_handler.js";

/*
General DNR (DeclarativeNetRequest) strategy:
 - all `main_frame` resources are forwarded to a `checking.html` page where the extension
    can asynchronously verify whether the host is SCION capable. If it is, redirect to that
    resource, otherwise show a blocking-page
 - all other sub-resources are forwarded to the `/redirect` endpoint of the proxy and then
    handled by the `onHeadersReceived` function that, based on the returned statuscode, determines
    whether the host was scion capable (to prevent future requests from going to the proxy again)
 - for all hosts known to the extension, a DNR rule with higher priority is installed to
    override the generic redirect rules mentioned above, thus preventing proxy lookup loops (a
    hypothetical lookup loop example that assumes `example.com` is SCION-capable: user enters
    `example.com`, redirected to the proxy => proxy redirects to `example.com` => again redirected
    to the proxy etc.)
 */

// custom DNR rules (the ID simultaneously represents its priority)
const SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID = 1;
const MAIN_FRAME_REDIRECT_RULE_ID = 2;
const SUBRESOURCES_REDIRECT_RULE_ID = 3;

// sufficiently high to have space for custom DNR rules (specified above)
const BLOCK_RULE_START_ID = 10000;
const NextDnrRuleId = "nextDnrRuleId"
const PerSiteStrictMode = "perSiteStrictMode";

const EXT_PAGE = chrome.runtime.getURL('/checking.html');
const ALL_RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "font", "media", "stylesheet", "object", "other", "ping", "websocket", "webtransport"];
const MAIN_FRAME_TYPE = ["main_frame"];
const SUBRESOURCE_TYPES = ["sub_frame", "xmlhttprequest", "script", "image", "font", "media", "stylesheet", "object", "other", "ping", "websocket", "webtransport"];

/**
 * Initializes the DNR handler.
 *
 * Note that since this function is called from the service worker and these are ephemeral in MV3, this function will be called quite often (e.g. when the user opens a new tab).
 */
export async function initializeDnr(globalStrictMode) {
    console.log("Initializing DNR");

    // initialize NextDnrRuleId in sync storage (if not initialized already)
    const nextDnrRuleId = await getStorageValue(NextDnrRuleId);
    if (!nextDnrRuleId) {
        await saveStorageValue(NextDnrRuleId, BLOCK_RULE_START_ID);
    }

    await setGlobalStrictMode(globalStrictMode);
}

/**
 * Function that enforces the global strict mode based on the boolean value passed in `globalStrictMode` by
 * installing DNR rules.
 */
export async function setGlobalStrictMode(globalStrictMode) {
    // TODO: possibly improve this function by considering already existing rules and reusing them
    await removeAllDnrBlockRules();
    if (globalStrictMode) {
        const databaseAdapter = await getRequestsDatabaseAdapter();
        const requests = await databaseAdapter.get();

        let allowedHostsWithId = [];
        let blockedHostsWithId = [];
        for (const request of requests) {
            const entry = [request.domain, request.dnrRuleId];
            if (request.scionEnabled) allowedHostsWithId.push(entry);
            else blockedHostsWithId.push(entry);
        }

        let dnrRules = [
            createMainFrameRedirectRule(MAIN_FRAME_REDIRECT_RULE_ID),
            createSubResourcesRedirectRule(SUBRESOURCES_REDIRECT_RULE_ID),
        ];
        for (const hostWithId of allowedHostsWithId) {
            dnrRules.push(createAllowRule(hostWithId[0], hostWithId[1]));
        }
        for (const hostWithId of blockedHostsWithId) {
            dnrRules.push(createBlockRule(hostWithId[0], hostWithId[1]));
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: dnrRules,
            removeRuleIds: []
        });
    } else {
        // only handle perSiteStrictMode if global mode is off, otherwise global overrides them anyway
        // fallback to empty dictionary if no value was present in storage
        const perSiteStrictMode = await getStorageValue(PerSiteStrictMode) || {};
        await setPerSiteStrictMode(perSiteStrictMode);
    }
}

/**
 * Updates the DNR rules to handle individual strict sites (which are based on the `perSiteStrictMode` parameter).
 */
export async function setPerSiteStrictMode(perSiteStrictMode) {
    // TODO: possibly improve this function by considering already existing rules and reusing them
    // if globalStrictMode is on, do not change any DNR rules
    const globalStrictMode = await getStorageValue("globalStrictMode");
    if (globalStrictMode) return;

    const databaseAdapter = await getRequestsDatabaseAdapter();
    const requests = await databaseAdapter.get();
    let allowedHostsWithId = {};
    let blockedHostsWithId = {};
    for (const request of requests) {
        if (request.scionEnabled) allowedHostsWithId[request.domain] = request.dnrRuleId;
        else blockedHostsWithId[request.domain] = request.dnrRuleId;
    }

    await removeAllDnrBlockRules();
    const strictHosts = Object.entries(perSiteStrictMode)
        .filter(([, isStrict]) => isStrict)
        .map(([host]) => host);

    // adding rules that block each of the hosts directly
    let rules = [];
    for (const strictHost of strictHosts) {
        // if the extension has info about the host, add the appropriate DNR rule, otherwise perform a lookup
        if (Object.keys(blockedHostsWithId).includes(strictHost)) rules.push(createBlockRule(strictHost, blockedHostsWithId[strictHost]));
        else if (Object.keys(allowedHostsWithId).includes(strictHost)) rules.push(createAllowRule(strictHost, allowedHostsWithId[strictHost]));
        else {
            // using 0 as the tab id, as no tab can be associated with this request
            // isHostScion already adds the appropriate DNR rules based on the lookup result (including creating the DB entry for the host)
            await isHostScion(strictHost, "", 0);
        }
    }

    // the individual rules above are insufficient, as a site marked as 'strict' can invoke other sub-resources that
    // should be blocked, but might have a different hostname and thus might not have a matching rule
    // thus, a redirect rule is needed that redirects all requests whose initiator is marked as 'strict'
    const subresourceInitiatorRule = createSubResourcesInitiatorRedirectRule(SUBRESOURCES_INITIATOR_REDIRECT_RULE_ID, strictHosts);
    rules.push(subresourceInitiatorRule);

    await chrome.declarativeNetRequest.updateDynamicRules({addRules: rules, removeRuleIds: []});
}

/**
 * Creates a DNR blocking rule with the given `id` for the specified `host` and immediately enables this rule.
 *
 * Thus, only call this function, if the rule should also be applied immediately.
 *
 * @param host to be added as a non-scion page.
 * @param id the id of the rule created and applied by this function.
 */
export async function addDnrBlockingRule(host, id) {
    const rule = createBlockRule(host, id)
    await chrome.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []})
}

export async function addDnrAllowRule(host, id) {
    const rule = createAllowRule(host, id)
    await chrome.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []})
}

/**
 * removes all DNR block rules, functionally equivalent to calling removeDNRBlockRule for each non-scion page
 */
export async function removeAllDnrBlockRules(customRulesToRemoveIds = null) {
    let rulesToRemoveIds;
    if (customRulesToRemoveIds !== null) rulesToRemoveIds = customRulesToRemoveIds;
    else {
        // get all currently active rules and assign them to be removed
        const currentRules = await chrome.declarativeNetRequest.getDynamicRules()
        rulesToRemoveIds = currentRules.map(rule => rule.id);
    }

    if (!rulesToRemoveIds || rulesToRemoveIds.length === 0) return;

    await chrome.declarativeNetRequest.updateDynamicRules({addRules: [], removeRuleIds: rulesToRemoveIds});
}

function createBlockRule(host, id) {
    return {
        id: id,
        priority: 100,
        action: {type: 'block'},
        condition: {
            requestDomains: [host],
            resourceTypes: ALL_RESOURCE_TYPES
        }
    };
}

function createAllowRule(host, id) {
    return {
        id: id,
        priority: 101,
        action: {type: 'allow'},
        condition: {
            requestDomains: [host],
            resourceTypes: ALL_RESOURCE_TYPES
        }
    }
}

/**
 * Returns a DNR rule that redirects all `main_frame` requests to the `checking.html` page for a synchronous blocking lookup.
 */
function createMainFrameRedirectRule(id) {
    return {
        id: id,
        priority: id,
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
function createSubResourcesRedirectRule(id) {
    return {
        id: id,
        priority: id,
        action: {
            type: 'redirect',
            redirect: {
                // pass entire URL to the proxy for lookup
                regexSubstitution: `${proxyAddress}${proxyURLResolvePath}?${proxyURLResolveParam}=\\0`,
            },
        },
        condition: {
            regexFilter: '^.+$', // match any URL
            resourceTypes: SUBRESOURCE_TYPES,
            // exclude requests from the proxy to prevent lookup-loops
            excludedRequestDomains: [
                proxyHost,
                WPAD_URL,
            ],
        },
    };
}

/**
 * Returns a DNR rule that redirects all sub-resources whose initiator is in `blockedInitiators` to the `proxyURLResolvePath` endpoint.
 */
function createSubResourcesInitiatorRedirectRule(id, blockedInitiators) {
    return {
        id: id,
        priority: id,
        action: {
            type: 'redirect',
            redirect: {
                // pass entire URL to the proxy for lookup
                regexSubstitution: `${proxyAddress}${proxyURLResolvePath}?${proxyURLResolveParam}=\\0`,
            },
        },
        condition: {
            regexFilter: '^.+$', // match any URL
            resourceTypes: SUBRESOURCE_TYPES,
            initiatorDomains: blockedInitiators,
            // exclude requests from the proxy to prevent lookup-loops
            excludedRequestDomains: [
                proxyHost,
                WPAD_URL,
            ],
        }
    }
}

/**
 * Fetches (and returns it) the current value of `NextDnrRuleId` in sync storage and increases that value in storage by 1.
 */
export async function fetchNextDnrRuleId() {
    return withLock(async () => {
        const nextDnrRuleId = await getStorageValue(NextDnrRuleId)
        if (!nextDnrRuleId) {
            console.error("An error occurred during fetchNextDnrRuleId - There was no value stored, the default 'undefined' was returned.");
            return -100;
        }

        // increasing the value in storage by 1
        await saveStorageValue(NextDnrRuleId, nextDnrRuleId + 1);

        return nextDnrRuleId;
    })
}

// lock to prevent interleavings when generating block rule IDs since access to sync storage is async
let idLock = Promise.resolve();

function withLock(fn) {
    // chain the new work onto the previous one
    const p = idLock.then(fn, fn);
    // ensure errors don’t break the chain forever
    idLock = p.catch(() => {
    });
    return p;
}