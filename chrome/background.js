// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {initializeProxyHandler, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {EXTENSION_RUNNING, getSyncValue, GLOBAL_STRICT_MODE, PER_SITE_STRICT_MODE, saveSyncValue} from "./shared/storage.js";
import {initializeDnr, globalStrictModeUpdated, perSiteStrictModeUpdated, updateProxySettingsInDnrRules} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";

export let GlobalStrictMode = undefined;
export let PerSiteStrictMode = undefined;

/*--- setup ------------------------------------------------------------------*/

const initializeExtension = async () => {
    GlobalStrictMode = await getSyncValue(GLOBAL_STRICT_MODE);
    if (!GlobalStrictMode) {
        GlobalStrictMode = false;
        await saveSyncValue(GLOBAL_STRICT_MODE, GlobalStrictMode);
    }
    console.log(`[initializeExtension]: GlobalStrictMode: ${GlobalStrictMode}`);

    PerSiteStrictMode = await getSyncValue(PER_SITE_STRICT_MODE);
    if (!PerSiteStrictMode) {
        PerSiteStrictMode = {};
        await saveSyncValue(PER_SITE_STRICT_MODE, PerSiteStrictMode);
    }
    console.log(`[initializeExtension]: PerSiteStrictMode: ${PerSiteStrictMode}`);

    /*--- PAC --------------------------------------------------------------------*/
    // initializing proxy handler before DNR, as some DNR rules rely on the `proxyAddress`
    await initializeProxyHandler()
    /*--- END PAC ----------------------------------------------------------------*/

    await initializeDnr(GlobalStrictMode);
};
initializeExtension();

// Do icon setup etc at startup
getSyncValue(EXTENSION_RUNNING).then(async extensionRunning => {
    await updateRunningIcon(extensionRunning);
});

/*--- storage ----------------------------------------------------------------*/

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    // In case we disable running for the extension, lets put an empty set for now
    // Later, we could remove the PAC script, but doesn't impact us now...
    if (namespace === "sync") {
        if (changes.extension_running?.newValue !== undefined) {

            await updateRunningIcon(changes.extension_running.newValue);

        } else if (changes.isd_whitelist?.newValue) {

            geofence(changes.isd_whitelist.newValue);

        } else if (changes.perSiteStrictMode?.newValue !== undefined) {

            PerSiteStrictMode = changes.perSiteStrictMode.newValue || {};

            // update DNR rules
            await perSiteStrictModeUpdated();

        } else if (changes.globalStrictMode?.newValue !== undefined) {

            GlobalStrictMode = changes.globalStrictMode.newValue;

            // update DNR rules
            await globalStrictModeUpdated();

        } else if (changes.isd_all?.newValue !== undefined) {

            allowAllgeofence(changes.isd_all.newValue);

        } else if (changes.proxyScheme || changes.proxyHost || changes.proxyPort) {
            // Reload all proxy settings if any changed
            await loadProxySettings();

            resetPolicyCookie();

            await updateProxySettingsInDnrRules();
        }
    }
})

// Changes icon depending on the extension is running or not
async function updateRunningIcon(extensionRunning) {
    if (extensionRunning) {
        await chrome.action.setIcon({path: "/images/scion-38.jpg"});
    } else {
        await chrome.action.setIcon({path: "/images/scion-38_disabled.jpg"});
    }
}

/*--- END storage ------------------------------------------------------------*/

/*--- tabs -------------------------------------------------------------------*/
initializeTabListeners()

/*--- requests ---------------------------------------------------------------*/
initializeRequestInterceptionListeners()
