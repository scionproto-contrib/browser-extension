// Copyright 2024 ETH Zurich, Ovgu
'use strict';

// polyfill must only be imported in background.ts as the first import statement, loads the `browser` namespace into `globalThis`
// such that `browser.*` can be used everywhere (other contexts like popup and options are handled separately)
import "./vendor/browser-polyfill.js";

import {initializeProxyHandler, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {EXTENSION_RUNNING, getSyncValue, GLOBAL_STRICT_MODE, ISD_ALL, ISD_WHITELIST, PER_SITE_STRICT_MODE, saveSyncValue, type SyncValueSchema} from "./shared/storage.js";
import {globalStrictModeUpdated, initializeDnr, perSiteStrictModeUpdated, updateProxySettingsInDnrRules} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";

export let GlobalStrictMode: SyncValueSchema[typeof GLOBAL_STRICT_MODE] = false;
export let PerSiteStrictMode: SyncValueSchema[typeof PER_SITE_STRICT_MODE] = {};

/*--- setup ------------------------------------------------------------------*/

const initializeExtension = async () => {
    const storageGlobalStrictMode = await getSyncValue(GLOBAL_STRICT_MODE);
    GlobalStrictMode = storageGlobalStrictMode ?? false;
    if (storageGlobalStrictMode === undefined) await saveSyncValue(GLOBAL_STRICT_MODE, GlobalStrictMode);
    console.log(`[initializeExtension]: GlobalStrictMode: ${GlobalStrictMode}`);

    const storagePerSiteStrictMode = await getSyncValue(PER_SITE_STRICT_MODE);
    PerSiteStrictMode = storagePerSiteStrictMode ?? {};
    if (storagePerSiteStrictMode === undefined) await saveSyncValue(PER_SITE_STRICT_MODE, PerSiteStrictMode);
    console.log(`[initializeExtension]: PerSiteStrictMode: ${PerSiteStrictMode}`);

    /*--- PAC --------------------------------------------------------------------*/
    // initializing proxy handler before DNR, as some DNR rules rely on the `proxyAddress`
    await initializeProxyHandler()
    /*--- END PAC ----------------------------------------------------------------*/

    await initializeDnr();
};
initializeExtension();

// Do icon setup etc at startup
getSyncValue(EXTENSION_RUNNING).then(async extensionRunning => {
    await updateRunningIcon(extensionRunning);
});

/*--- storage ----------------------------------------------------------------*/

browser.storage.onChanged.addListener(async (changes, namespace) => {
    // In case we disable running for the extension, lets put an empty set for now
    // Later, we could remove the PAC script, but doesn't impact us now...
    if (namespace === "sync") {
        if (changes.extension_running?.newValue !== undefined) {

            await updateRunningIcon(changes.extension_running.newValue);

        } else if (changes.isd_all?.newValue !== undefined) {

            const isdAll = changes.isd_all.newValue as SyncValueSchema[typeof ISD_ALL];
            allowAllgeofence(isdAll);

        } else if (changes.isd_whitelist?.newValue) {

            const isdWhitelist = changes.isd_whitelist.newValue as SyncValueSchema[typeof ISD_WHITELIST];
            geofence(isdWhitelist);

        } else if (changes.perSiteStrictMode?.newValue !== undefined) {

            PerSiteStrictMode = (changes.perSiteStrictMode.newValue || {}) as SyncValueSchema[typeof PER_SITE_STRICT_MODE];

            // update DNR rules
            await perSiteStrictModeUpdated();

        } else if (changes.globalStrictMode?.newValue !== undefined) {

            GlobalStrictMode = changes.globalStrictMode.newValue as SyncValueSchema[typeof GLOBAL_STRICT_MODE];

            // update DNR rules
            await globalStrictModeUpdated();

        } else if (changes.proxyScheme || changes.proxyHost || changes.proxyPort) {
            // Reload all proxy settings if any changed
            await loadProxySettings();

            resetPolicyCookie();

            await updateProxySettingsInDnrRules();
        }
    }
})

// Changes icon depending on the extension is running or not
async function updateRunningIcon(extensionRunning: any) {
    if (extensionRunning) {
        await browser.action.setIcon({path: "/images/scion-38.jpg"});
    } else {
        await browser.action.setIcon({path: "/images/scion-38_disabled.jpg"});
    }
}

/*--- END storage ------------------------------------------------------------*/

/*--- tabs -------------------------------------------------------------------*/
initializeTabListeners()

/*--- requests ---------------------------------------------------------------*/
initializeRequestInterceptionListeners()
