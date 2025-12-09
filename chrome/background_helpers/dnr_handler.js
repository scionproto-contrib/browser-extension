import {getStorageValue, saveStorageValue} from "../shared/storage.js";
import {getRequestsDatabaseAdapter} from "../database.js";
import {WPAD_URL} from "./proxy_handler.js";

// sufficiently high to have space for custom allow/deny rules
const SUBRESOURCES_REDIRECT_RULE_ID = 1;
const BLOCK_RULE_START_ID = 10000;
const NextDnrRuleId = "nextDnrRuleId"

const ALL_RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "font", "media", "stylesheet", "object", "other", "ping", "websocket", "webtransport"];
const SUBRESOURCE_TYPES = ["sub_frame", "xmlhttprequest", "script", "image", "font", "media", "stylesheet", "object", "other", "ping", "websocket", "webtransport"];

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

export async function initializeDnr(globalStrictMode) {
    console.log("Initializing DNR");

    // initialize NextDnrRuleId in sync storage (if not initialized already)
    const nextDnrRuleId = await getStorageValue(NextDnrRuleId);
    if (!nextDnrRuleId) {
        await saveStorageValue(NextDnrRuleId, BLOCK_RULE_START_ID);
    }

    await setGlobalStrictMode(globalStrictMode);

    // TODO: add selective DNR rules for pages that were specifically set to 'strict' by the user
}

export async function setGlobalStrictMode(globalStrictMode) {
    if (globalStrictMode) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [createSubResourcesRedirectRule(SUBRESOURCES_REDIRECT_RULE_ID)],
            removeRuleIds: []
        });

        // TODO: additionally, also add higher-priority rules for those hosts already known through storage
    } else {
        await removeAllDnrBlockRules();
    }
}

// Redirect all sub-resource requests to checking.html
function createSubResourcesRedirectRule(id) {
    return {
        id,
        priority: 1,
        action: {
            type: 'redirect',
            redirect: {
                // Match entire URL and stick it behind a hash
                regexSubstitution:  'https://forward-proxy.scion.ethz.ch:9443/redirect?url=\\0',
            },
        },
        condition: {
            regexFilter: '^.+$',         // match any URL (or restrict to https? if you want)
            resourceTypes: SUBRESOURCE_TYPES,
            excludedRequestDomains: [
                "forward-proxy.scion.ethz.ch",
                WPAD_URL,
            ],
        },
    };
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
 * Removes any existing rules, then adds back all block rules of non-scion pages
 */
export async function reAddAllDnrBlockRules() {
    const databaseAdapter = await getRequestsDatabaseAdapter();
    const requestsNonScion = await databaseAdapter.get({scionEnabled: false}, false);
    const domainIdPairs = requestsNonScion.map((entry) => ({
        domain: entry.domain,
        dnrBlockRuleId: entry.dnrBlockRuleId,
    }));

    await removeAllDnrBlockRules();
    await addMultipleDnrBlockingRules(domainIdPairs);
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

/**
 * Creates rules for all key-value pairs in `entries` and applies these rules with a single call to `updateDynamicRules`.
 *
 * Note: This function is functionally equivalent to calling `addDnrBlockingRule` for each entry individually.
 */
async function addMultipleDnrBlockingRules(entries) {
    const rules = entries.map(entry => createBlockRule(entry.domain, entry.dnrBlockRuleId));
    await chrome.declarativeNetRequest.updateDynamicRules({addRules: rules, removeRuleIds: []});
}

function createBlockRule(host, id) {
    return {
        id,
        priority: 1,
        action: {type: 'block'},
        condition: {
            requestDomains: [host],
            resourceTypes: ALL_RESOURCE_TYPES
        }
    };
}

function createAllowRule(host, id) {
    return {
        id,
        priority: 100,
        action: {type: 'allow'},
        condition: {
            requestDomains: [host],
            resourceTypes: ALL_RESOURCE_TYPES
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
