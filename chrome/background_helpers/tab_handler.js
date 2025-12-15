import {getTabResources} from "../shared/storage.js";

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