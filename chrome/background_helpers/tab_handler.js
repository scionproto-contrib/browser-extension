import {clearAllTabResources, clearTabResources, getTabResources} from "../shared/storage.js";

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
async function handleTabChange(tab) {
    if (tab.active && tab.url) {
        const url = new URL(tab.url);

        let mixedContent;
        const resources = await getTabResources(tab.id) ?? [];
        const mainDomainSCIONEnabled = resources.find(resource => resource[0] === url.hostname && resource[1]);
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
    }
}