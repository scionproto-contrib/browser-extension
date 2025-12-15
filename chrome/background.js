// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {initializeProxyHandler, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {getStorageValue, saveStorageValue} from "./shared/storage.js";
import {initializeDnr, setGlobalStrictMode, setPerSiteStrictMode} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners, resetKnownHostnames} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";


const GlobalStrictMode = "globalStrictMode"

/*--- setup ------------------------------------------------------------------*/

getStorageValue(GlobalStrictMode).then(async (syncGlobalStrictMode) => {
    console.log("globalStrictMode: value in sync storage is set to", syncGlobalStrictMode);
    let globalStrictMode = false;
    if (!syncGlobalStrictMode) {
        console.log("globalStrictMode: thus setting globalStrictMode to", globalStrictMode);
        await saveStorageValue(GlobalStrictMode, globalStrictMode);
    } else {
        globalStrictMode = syncGlobalStrictMode;
    }

    await initializeDnr(globalStrictMode);
})

// Do icon setup etc at startup
getStorageValue('extension_running').then(async extensionRunning => {
    await updateRunningIcon(extensionRunning);
});


/*--- PAC --------------------------------------------------------------------*/
initializeProxyHandler()
/*--- END PAC ----------------------------------------------------------------*/

/*--- storage ----------------------------------------------------------------*/

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    // In case we disable running for the extension, lets put an empty set for now
    // Later, we could remove the PAC script, but doesn't impact us now...
    if (namespace == "sync") {
        if (changes.extension_running?.newValue !== undefined) {

            await updateRunningIcon(changes.extension_running.newValue);

        } else if (changes.isd_whitelist?.newValue) {

            geofence(changes.isd_whitelist.newValue);

        } else if (changes.perSiteStrictMode?.newValue !== undefined) {

            // update DNR rules
            await setPerSiteStrictMode(changes.perSiteStrictMode.newValue || {});

        } else if (changes.globalStrictMode?.newValue !== undefined) {

            // update DNR rules
            await setGlobalStrictMode(changes.globalStrictMode.newValue);

        } else if (changes.isd_all?.newValue !== undefined) {

            allowAllgeofence(changes.isd_all.newValue);

        } else if (namespace === 'sync' && (changes.proxyScheme || changes.proxyHost || changes.proxyPort)) {
            // Reload all proxy settings if any changed
            loadProxySettings();

            resetKnownHostnames()
            resetPolicyCookie()
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
