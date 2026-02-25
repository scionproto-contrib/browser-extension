// Copyright 2024 ETH Zurich, Ovgu
'use strict';

// polyfill must only be imported in background.ts as the first import statement, loads the `browser` namespace into `globalThis`
// such that `browser.*` can be used everywhere (other contexts like popup and options are handled separately)
import "./vendor/browser-polyfill.js";

import {initializeProxyHandler, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {GLOBAL_STRICT_MODE, ISD_ALL, ISD_WHITELIST, PER_SITE_STRICT_MODE, type SyncValueSchema} from "./shared/storage.js";
import {globalStrictModeUpdated, initializeDnr, perSiteStrictModeUpdated, updateProxySettingsInDnrRules} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";
import {initializeIsChromium, initializeStrictModes, setGlobalStrictMode, setPerSiteStrictMode} from "./shared/utilities.js";


/*--- setup ------------------------------------------------------------------*/
// Initialize IsChromium
initializeIsChromium();

const initializeExtension = async () => {
    await initializeStrictModes();

    /*--- PAC --------------------------------------------------------------------*/
    // initializing proxy handler before DNR, as some DNR rules rely on the `proxyAddress`
    await initializeProxyHandler()
    /*--- END PAC ----------------------------------------------------------------*/

    await initializeDnr();

    // set initial icon to the neutral blue variant
    await browser.action.setIcon({path: "/images/scion-38.jpg"});
};
initializeExtension();

/*--- storage ----------------------------------------------------------------*/

browser.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === "sync") {
        if (changes.isd_all?.newValue !== undefined) {

            const isdAll = changes.isd_all.newValue as SyncValueSchema[typeof ISD_ALL];
            allowAllgeofence(isdAll);

        } else if (changes.isd_whitelist?.newValue) {

            const isdWhitelist = changes.isd_whitelist.newValue as SyncValueSchema[typeof ISD_WHITELIST];
            geofence(isdWhitelist);

        } else if (changes.perSiteStrictMode?.newValue !== undefined) {

            setPerSiteStrictMode((changes.perSiteStrictMode.newValue || {}) as SyncValueSchema[typeof PER_SITE_STRICT_MODE]);

            // update DNR rules
            await perSiteStrictModeUpdated();

        } else if (changes.globalStrictMode?.newValue !== undefined) {

            setGlobalStrictMode(changes.globalStrictMode.newValue as SyncValueSchema[typeof GLOBAL_STRICT_MODE]);

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
