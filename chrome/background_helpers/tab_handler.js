import {clearAllTabResources, clearTabResources, getTabResources} from "../shared/storage.js";
import {safeHostname} from "../shared/utilities.js";

export function initializeTabListeners() {
    // User switches between tabs
    chrome.tabs.onActivated.addListener(async function (activeInfo) {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await handleTabChange(tab);
    });

    // Update icon depending on hostname of current active tab
    chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
        await handleTabChange(tab);
    });

    // when a tab is closed, remove any information that was associated with that tab (resources it requested)
    chrome.tabs.onRemoved.addListener(async function (tabId) {
        await clearTabResources(tabId);
    });

    // when a window is closed, this is equivalent to all tabs
    chrome.windows.onRemoved.addListener(async function (windowId) {
        const window = await chrome.windows.get(windowId);
        const tabs = window.tabs;
        for (const tab of tabs) {
            await clearTabResources(tab.id);
        }
    });

    // when a window is created, and it is the only open window (i.e. browser just launched), clear all knowledge about the tabs
    // this functionality is only needed if the browser crashes and thus, the tabs' and windows' onRemoved event doesn't fire
    chrome.windows.onCreated.addListener(async function (window) {
        const windows = await chrome.windows.getAll();
        let onlySingleWindowOpen = true;
        for (const w of windows) {
            if (w.id !== window.id) {
                onlySingleWindowOpen = false;
                break;
            }
        }

        if (onlySingleWindowOpen) {
            await clearAllTabResources();
        }
    })
}

// Displays a green/blue SCION icon depending on the current url is
// being forwarded via SCION
export async function handleTabChange(tab) {
    if (!tab.active) return;
    if (tab.url) {
        const hostname = safeHostname(tab.url);

        let mixedContent;
        const resources = await getTabResources(tab.id) ?? [];
        const mainDomainSCIONEnabled = resources.find(resource => resource[0] === hostname && resource[1]);
        for (const resource of resources) {
            if (!resource[1]) {
                mixedContent = true;
                break;
            }
        }

        if (mainDomainSCIONEnabled) {
            if (mixedContent) {
                await chrome.action.setIcon({path: "/images/scion-38_mixed.jpg"});
            } else {
                await chrome.action.setIcon({path: "/images/scion-38_enabled.jpg"});
            }
        } else {
            await chrome.action.setIcon({path: "/images/scion-38_not_available.jpg"});
        }

        return;
    }

    // in case the tab object does not contain a URL, do a best-effort fallback by just setting the domain to 'not-available' if all resources are non-scion
    let allScion = true;
    let allNonScion = true;
    const resources = await getTabResources(tab.id) ?? [];
    for (const resource of resources) {
        const scionEnabled = resource[1];

        if (!scionEnabled) {
            allScion = false;
        } else {
            allNonScion = false;
        }
    }

    if (allNonScion)
        await chrome.action.setIcon({path: "/images/scion-38_not_available.jpg"});
    else if (allScion)
        await chrome.action.setIcon({path: "/images/scion-38_enabled.jpg"});
    else
        await chrome.action.setIcon({path: "/images/scion-38_mixed.jpg"});
}