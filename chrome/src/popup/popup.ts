// Copyright 2024 ETH Zurich, Ovgu
'use strict';


import {getTabResources} from "../shared/storage.js";
import {loadProxySettingsNoUpdate} from "../background_helpers/proxy_handler.js";
import {initializeStrictModes, safeHostname} from "../shared/utilities.js";
import {initializeConfiguration} from "./popup_configuration.js";
import {initializeResourceAndPathInformation} from "./popup_resource_information.js";
import {initializeCountryLookup} from "./country_code_utils.js";

type Tab = chrome.tabs.Tab;

// information about the website
let hostname = "";
let resources: [string, boolean][] = [];
let mainDomainScionEnabled = false;

document.addEventListener("DOMContentLoaded", async () => {
    // initialize values/variables required for the popup
    await initializeStrictModes();
    await loadProxySettingsNoUpdate();

    try {
        await loadSiteInformation();
    } catch (error) {
        console.error(error);
        return;
    }

    // initialize UI, populate the popup with data
    await initializeCountryLookup();
    await initializeConfiguration(hostname, resources, mainDomainScionEnabled);
    await initializeResourceAndPathInformation(hostname, resources, mainDomainScionEnabled);
});

/**
 * Loads information about the current website such that it can be passed to the UI.
 *
 * Throws an error if any of the following occur:
 * - `activeTab.url` is undefined
 * - hostname extraction via {@link safeHostname} returned null
 * - `activeTab.id` is undefined
 */
async function loadSiteInformation() {
    const tabs: Tab[] = await chrome.tabs.query({active: true, currentWindow: true});
    const activeTab: Tab = tabs[0];
    if (activeTab.url === undefined) {
        console.error("[Popup]: activeTab.url was undefined");
        throw new Error("[Popup]: activeTab.url was undefined");
    }

    let nullableHostname = safeHostname(activeTab.url);
    if (nullableHostname === null) {
        throw new Error(`[Popup]: error extracting hostname from url ${activeTab.url}`);
    }

    hostname = nullableHostname;

    const activeTabId = activeTab.id;
    if (activeTabId === undefined) {
        throw new Error(`[Popup]: activeTabId was undefined for page with hostname: ${hostname}`);
    }

    // ensure that no fetches made by the options page (e.g. to determine proxy reachability) end up in the UI
    if (activeTab.url.includes(chrome.runtime.getURL("src/options/options.html"))){
        resources = [];
    } else {
        resources = await getTabResources(activeTabId) ?? [];
    }

    mainDomainScionEnabled = resources.some(resource => resource[0] === hostname && resource[1]);
}