// Copyright 2024 ETH Zurich, Ovgu
'use strict';

import {fetchAndApplyScionPAC, loadProxySettings} from "./background_helpers/proxy_handler.js";
import {allowAllgeofence, geofence, resetPolicyCookie} from "./background_helpers/geofence_handler.js";
import {getStorageValue, saveStorageValue} from "./shared/storage.js";
import {initializeDnr} from "./background_helpers/dnr_handler.js";
import {initializeRequestInterceptionListeners, resetKnownHostnames} from "./background_helpers/request_interception_handler.js";
import {initializeTabListeners} from "./background_helpers/tab_handler.js";


const GLOBAL_STRICT_MODE = "globalStrictMode"

/** Background State */
export let globalStrictMode = false;
let perSiteStrictMode = {};

/*--- setup ------------------------------------------------------------------*/

getStorageValue(GLOBAL_STRICT_MODE).then( async(syncGlobalStrictMode) => {
    console.log("globalStrictMode: value in sync storage is set to", syncGlobalStrictMode);
    if (!syncGlobalStrictMode) {
        console.log("globalStrictMode: thus setting globalStrictMode to", globalStrictMode);
        await saveStorageValue(GLOBAL_STRICT_MODE, globalStrictMode);
    } else {
        globalStrictMode = syncGlobalStrictMode;
    }

    await initializeDnr(globalStrictMode);
})

getStorageValue('perSiteStrictMode').then((val) => {
    perSiteStrictMode = val || {}; // Here we may get undefined which is bad
});
// Do icon setup etc at startup
getStorageValue('extension_running').then(extensionRunning => {
    updateRunningIcon(extensionRunning);
});


/*--- PAC --------------------------------------------------------------------*/
// Load saved configuration at startup
chrome.storage.sync.get({ autoProxyConfig: true }, ({ autoProxyConfig }) => {
    if (autoProxyConfig) {
        fetchAndApplyScionPAC();
    } else {
        loadProxySettings();
    }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "fetchAndApplyScionPAC") {
        fetchAndApplyScionPAC();
        return true;
    }
});
/*--- END PAC ----------------------------------------------------------------*/

/*--- storage ----------------------------------------------------------------*/

chrome.storage.onChanged.addListener((changes, namespace) => {
    // In case we disable running for the extension, lets put an empty set for now
    // Later, we could remove the PAC script, but doesn't impact us now...
    if (namespace == 'sync' && changes.extension_running?.newValue !== undefined) {
        updateRunningIcon(changes.extension_running.newValue);
    } else if (namespace == 'sync' && changes.isd_whitelist?.newValue) {
        geofence(changes.isd_whitelist.newValue);
    } else if (namespace == 'sync' && changes.perSiteStrictMode?.newValue !== undefined) {
        perSiteStrictMode = changes.perSiteStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.globalStrictMode?.newValue !== undefined) {
        globalStrictMode = changes.globalStrictMode?.newValue;
    } else if (namespace == 'sync' && changes.isd_all?.newValue !== undefined) {
        allowAllgeofence(changes.isd_all.newValue);
    } else if (namespace === 'sync' && (changes.proxyScheme || changes.proxyHost || changes.proxyPort)) {
        // Reload all proxy settings if any changed
        loadProxySettings();

        resetKnownHostnames()
        resetPolicyCookie()
    }
})

// Changes icon depending on the extension is running or not
function updateRunningIcon(extensionRunning) {
    if (extensionRunning) {
        chrome.action.setIcon({ path: "/images/scion-38.jpg" });
    } else {
        chrome.action.setIcon({ path: "/images/scion-38_disabled.jpg" });
    }
}

/*--- END storage ------------------------------------------------------------*/

/*--- tabs -------------------------------------------------------------------*/
initializeTabListeners()

/*--- requests ---------------------------------------------------------------*/
initializeRequestInterceptionListeners()
