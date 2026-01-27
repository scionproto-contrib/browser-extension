import {clearAllTabResources, clearTabResources, getTabResources} from "../shared/storage.js";
import {safeHostname} from "../shared/utilities.js";
import type {Tabs} from "webextension-polyfill";

type Tab = Tabs.Tab;

export function initializeTabListeners() {
    // User switches between tabs
    browser.tabs.onActivated.addListener(async function (activeInfo) {
        const tab = await browser.tabs.get(activeInfo.tabId);
        await handleTabChange(tab);
    });

    // Update icon depending on hostname of current active tab
    browser.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
        await handleTabChange(tab);
    });

    // when a tab is closed, remove any information that was associated with that tab (resources it requested)
    browser.tabs.onRemoved.addListener(async function (tabId) {
        await clearTabResources(tabId);
    });

    // when a window is created, and it is the only open window (i.e. browser just launched), clear all knowledge about the tabs
    // this functionality is only needed if the browser crashes and thus, the tabs' and windows' onRemoved event doesn't fire
    browser.windows.onCreated.addListener(async function (window) {
        const windows = await browser.windows.getAll();
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
export async function handleTabChange(tab: Tab) {
    if (!tab.active) return;

    const resources: [string, boolean][] = tab.id !== undefined ? await getTabResources(tab.id) ?? [] : [];
    if (tab.url) {
        const hostname: string | null = safeHostname(tab.url);

        let mixedContent;
        const mainDomainSCIONEnabled: [string, boolean] | undefined = resources.find(resource => resource[0] === hostname && resource[1]);
        for (const resource of resources) {
            if (!resource[1]) {
                mixedContent = true;
                break;
            }
        }

        if (mainDomainSCIONEnabled) {
            if (mixedContent)
                await browser.action.setIcon({path: "/images/scion-38_mixed.jpg"});
            else
                await browser.action.setIcon({path: "/images/scion-38_enabled.jpg"});
        } else {
            await browser.action.setIcon({path: "/images/scion-38_not_available.jpg"});
        }

        return;
    }

    // in case the tab object does not contain a URL, do a best-effort fallback by just setting the domain to 'not-available' if all resources are non-scion
    let allScion = true;
    let allNonScion = true;
    for (const resource of resources) {
        const scionEnabled: boolean = resource[1];

        if (!scionEnabled) {
            allScion = false;
        } else {
            allNonScion = false;
        }
    }

    if (allNonScion)
        await browser.action.setIcon({path: "/images/scion-38_not_available.jpg"});
    else if (allScion)
        await browser.action.setIcon({path: "/images/scion-38_enabled.jpg"});
    else
        await browser.action.setIcon({path: "/images/scion-38_mixed.jpg"});
}