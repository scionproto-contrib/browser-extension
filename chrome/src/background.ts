// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {initializeProxyHandler, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {GLOBAL_STRICT_MODE, ISD_ALL, ISD_WHITELIST, PER_SITE_STRICT_MODE, type SyncValueSchema} from "./shared/storage.js";
import {globalStrictModeUpdated, initializeDnr, perSiteStrictModeUpdated, updateProxySettingsInDnrRules} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";
import {initializeStrictModes, setGlobalStrictMode, setPerSiteStrictMode} from "./shared/utilities.js";
import {evictExpiredEntries} from "./shared/database.js";


/*--- setup ------------------------------------------------------------------*/

const initializeExtension = async () => {
    await initializeStrictModes();

    // on startup of the SW, check for expired entries and evict them
    await evictExpiredEntries();

    /*--- PAC --------------------------------------------------------------------*/
    // initializing proxy handler before DNR, as some DNR rules rely on the `proxyAddress`
    await initializeProxyHandler()
    /*--- END PAC ----------------------------------------------------------------*/

    await initializeDnr();

    // set initial icon to the neutral blue variant
    await chrome.action.setIcon({path: "/images/scion-38.jpg"});
};
initializeExtension();

/*--- storage ----------------------------------------------------------------*/

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === "sync") {
        if (changes.isd_all?.newValue !== undefined) {

            const isdAll = changes.isd_all.newValue as SyncValueSchema[typeof ISD_ALL];
            allowAllgeofence(isdAll);

        } else if (changes.isd_whitelist?.newValue) {

            const isdWhitelist = changes.isd_whitelist.newValue as SyncValueSchema[typeof ISD_WHITELIST];
            geofence(isdWhitelist);

        } else if (changes.perSiteStrictMode?.newValue !== undefined) {

            const perSiteStrictMode = (changes.perSiteStrictMode.newValue || {}) as SyncValueSchema[typeof PER_SITE_STRICT_MODE];
            setPerSiteStrictMode(perSiteStrictMode);

            // update DNR rules
            await perSiteStrictModeUpdated();

        } else if (changes.globalStrictMode?.newValue !== undefined) {

            const globalStrictMode = changes.globalStrictMode.newValue as SyncValueSchema[typeof GLOBAL_STRICT_MODE];
            setGlobalStrictMode(globalStrictMode);

            // update DNR rules
            await globalStrictModeUpdated();

        } else if (changes.proxyScheme || changes.proxyHost || changes.proxyPort) {
            // Reload all proxy settings if any changed
            await loadProxySettings();

            resetPolicyCookie();

            await updateProxySettingsInDnrRules();
        }
    }
});

/*--- END storage ------------------------------------------------------------*/

/*--- tabs -------------------------------------------------------------------*/
initializeTabListeners()

/*--- requests ---------------------------------------------------------------*/
initializeRequestInterceptionListeners()
