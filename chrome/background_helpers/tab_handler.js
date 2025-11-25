import {getRequestsDatabaseAdapter} from "../database.js";

export function initializeTabListeners() {
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
}

// Displays a green/blue SCION icon depending on the current url is
// being forwarded via SCION
async function handleTabChange(tab) {
    if (tab.active && tab.url) {
        const url = new URL(tab.url);
        const databaseAdapter = await getRequestsDatabaseAdapter();
        let requests = await databaseAdapter.get({ mainDomain: url.hostname });
        let mixedContent;

        const mainDomainSCIONEnabled = requests.find(r => r.tabId === tab.id && r.domain === url.hostname && r.scionEnabled);
        requests.forEach(r => {
            if (!r.scionEnabled) {
                mixedContent = true;
            }
        });
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