// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// Copyright 2024 ETH Zurich, Ovgu
'use strict';

// Default proxy configuration values
import {
    AUTO_PROXY_CONFIG,
    getSyncValue,
    getSyncValues,
    GLOBAL_STRICT_MODE,
    ISD_ALL,
    ISD_WHITELIST,
    PER_SITE_STRICT_MODE,
    PROXY_HOST,
    PROXY_PORT,
    PROXY_SCHEME,
    saveSyncValue,
    saveSyncValues
} from "./shared/storage.js";
import {DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT, HTTPS_PROXY_SCHEME, type OnMessageMessageType} from "./background_helpers/proxy_handler.js";
import {initializeIsChromium} from "./shared/utilities.js";

// initializing the value in the 'options'-context
initializeIsChromium();

const DEFAULT_PROXY_SCHEME = HTTPS_PROXY_SCHEME;
const DEFAULT_PROXY_PORT = HTTPS_PROXY_PORT;

const toggleGlobalStrict = document.getElementById('toggleGlobalStrict') as HTMLInputElement;
const checkboxGlobalStrict = document.getElementById('checkboxGlobalStrict') as HTMLDivElement;
const lineStrictMode = document.getElementById('lineStrictMode') as HTMLDivElement;
const tableSitePreferences = document.getElementById('tableBodySitePreferences')!;
const checkBoxNewDomainStrictMode = document.getElementById('checkBoxNewDomainStrictMode') as HTMLDivElement;
const toggleNewDomainStrictMode = document.getElementById('toggleNewDomainStrictMode') as HTMLInputElement;
const lineNewDomainStrictMode = document.getElementById('lineNewDomainStrictMode') as HTMLDivElement;
const inputNewDomain = document.getElementById('inputNewDomain') as HTMLInputElement;
const scionMode = document.getElementById('scionmode') as HTMLSpanElement;
const proxySchemeElement = document.getElementById('proxy-scheme') as HTMLSelectElement;
const proxyHostElement = document.getElementById('proxy-host') as HTMLInputElement;
const proxyPortElement = document.getElementById('proxy-port') as HTMLInputElement;


const tableSitePreferencesRow = ` 
<tr>
<td class="p-2 whitespace-nowrap">
  <div class="text-left">{site}</div>
</td>
<td class="p-2 whitespace-nowrap flex">
  <div class="text-left font-medium mr-3">
    <div class="relative cursor-pointer" id="checkBoxSite-{site}">
      <input id="toggleSite-{site}" {checked} type="checkbox" class="site-pref-entry sr-only" />
      <div class="w-8 h-4 bg-gray-400 rounded-full shadow-inner" style="background-color: {backgroundColor};"></div>
      <div class="dot2 absolute w-4 h-4 bg-white rounded-full shadow -left-1 -top-0 transition"></div>
    </div>
  </div>
  <span style="font-size: 12px">{mode}</span>
</td>
</tr>`

const placeholderToggleID = "toggleISD-";

document.addEventListener("DOMContentLoaded", async () => {
    const isdSet = await getSyncValue(ISD_WHITELIST, []);
    displayToggleISD(isdSet);

    const trafficToggle = document.getElementById("allowAllTrafficToggle") as HTMLInputElement;
    trafficToggle.checked = await getSyncValue(ISD_ALL, true);

    registerToggleISDHandler();
    registerToggleAllHandler();
});

function displayToggleISD(isdSet: string[]) {
    if (!isdSet) {
        return;
    }
    for (const id of isdSet) {
        const isdToggle = document.getElementById(placeholderToggleID + id) as HTMLInputElement;
        if (isdToggle) isdToggle.checked = true;
    }
}

function registerToggleISDHandler() {
    const isdToggles = document.getElementsByClassName("isd-entry");
    for (let i = 0; i < isdToggles.length; i++) {
        const isdToggle = isdToggles[i] as HTMLInputElement;
        const parentDiv = isdToggle.parentElement!;
        parentDiv.onclick = () => {
            toggleISD(isdToggles[i].id);
        }
    }
}


function registerToggleAllHandler() {
    const allToggle = document.getElementById("allowAllTrafficToggle") as HTMLInputElement;
    console.log(allToggle)
    const parentDiv = allToggle.parentElement!;
    parentDiv.onclick = () => {
        toggleAll(allToggle.id);
    }
}

function toggleISD(checked_id: string) {
    const isdToggle = document.getElementById(checked_id) as HTMLInputElement;
    isdToggle.checked = !isdToggle.checked;
    const id = checked_id.split("toggleISD-")[1]!;
    applyWhitelist(id, isdToggle.checked);
}

async function toggleAll(checked_id: string) {
    const isdToggle = document.getElementById(checked_id) as HTMLInputElement;
    isdToggle.checked = !isdToggle.checked;
    console.log(isdToggle.checked)
    await saveSyncValue(ISD_ALL, isdToggle.checked);
}


async function applyWhitelist(isd: string, checked: boolean) {
    const isdList = await getSyncValue(ISD_WHITELIST, []);
    const isdSet = await toSet(removeEmptyEntries(isdList));
    if (checked) {
        isdSet.add(isd);
        console.log('Added isd to list: ' + isd);
    } else {
        isdSet.delete(isd);
        console.log('Delete isd to list: ' + isd);
    }
    const isdSet_1 = isdSet;
    await saveSyncValue(ISD_WHITELIST, [...isdSet_1]);
    console.log([...isdSet_1]);
}

function removeEmptyEntries<T>(list: T[]): T[] {
    if (!list) {
        return list;
    }
    return list.filter((l: T) => !!l);
}

/* Optional Javascript to close the radio button version by clicking it again */
const myRadios = document.getElementsByName('tabs2') as NodeListOf<HTMLInputElement>;
let setCheck: HTMLInputElement | null = null;
let x: number;
for (x = 0; x < myRadios.length; x++) {
    const radio: HTMLInputElement = myRadios[x]!;
    radio.onclick = function () {
        if (setCheck != radio) {
            setCheck = radio;
        } else {
            radio.checked = false;
            setCheck = null;
        }
    };
}

function toggleGlobalStrictMode() {
    toggleGlobalStrict.checked = !toggleGlobalStrict.checked;
    if (toggleGlobalStrict.checked) {
        lineStrictMode.style.backgroundColor = '#48bb78';
    } else {
        lineStrictMode.style.backgroundColor = '#cccccc';
    }
    saveSyncValue(GLOBAL_STRICT_MODE, toggleGlobalStrict.checked);
}

getSyncValue(GLOBAL_STRICT_MODE, false).then(globalStrictMode => {
    toggleGlobalStrict.checked = globalStrictMode;
    if (toggleGlobalStrict.checked) {
        lineStrictMode.style.backgroundColor = '#48bb78';
    } else {
        lineStrictMode.style.backgroundColor = '#cccccc';
    }
});

function updateSitePreferences() {
    getSyncValue(PER_SITE_STRICT_MODE, {}).then(perSiteStrictMode => {
        tableSitePreferences.innerHTML = '';
        Object.keys(perSiteStrictMode || {}).forEach(k => {
            let row = tableSitePreferencesRow.replaceAll("{site}", k);
            row = row.replaceAll("{checked}", perSiteStrictMode[k] ? "checked=true" : "");
            row = row.replaceAll("{mode}", perSiteStrictMode[k] ? 'strict' : 'when available');
            row = row.replaceAll("{backgroundColor}", perSiteStrictMode[k] ? '#48bb78' : '');
            tableSitePreferences.innerHTML += row;
        });
        registerToggleSitePreferenceHandler();
    });
}

updateSitePreferences();

function registerToggleSitePreferenceHandler() {
    const toggles = document.getElementsByClassName("site-pref-entry");
    for (let i = 0; i < toggles.length; i++) {
        const toggle = toggles[i]!;
        const parentDiv = toggle.parentElement!;
        parentDiv.onclick = () => {
            toggleSitePreference(toggles[i].id);
        }
    }
}

function toggleSitePreference(checked_id: string) {
    const isdToggle = document.getElementById(checked_id) as HTMLInputElement;
    isdToggle.checked = !isdToggle.checked;
    const domain = checked_id.split("toggleSite-")[1]!;
    getSyncValue(PER_SITE_STRICT_MODE, {}).then(perSiteStrictMode => {
        perSiteStrictMode[domain] = isdToggle.checked;
        saveSyncValue(PER_SITE_STRICT_MODE, perSiteStrictMode).then(() => {
            updateSitePreferences();
        });
    });
}

checkboxGlobalStrict.addEventListener('click', function () {
    toggleGlobalStrictMode();
});

const addHostnameButton = document.getElementById("buttonAddHostname") as HTMLButtonElement;
addHostnameButton.addEventListener('click', function () {
    const newDomainInput = document.getElementById('inputNewDomain') as HTMLInputElement;
    const domain = newDomainInput.value;
    const strictMode = toggleNewDomainStrictMode.checked;
    getSyncValue(PER_SITE_STRICT_MODE, {}).then(perSiteStrictMode => {
        perSiteStrictMode[domain] = strictMode;
        saveSyncValue(PER_SITE_STRICT_MODE, perSiteStrictMode).then(() => {
            updateSitePreferences();
            toggleNewDomainStrictMode.checked = false;
            inputNewDomain.value = '';
            lineNewDomainStrictMode.style.backgroundColor = '';
            scionMode.innerHTML = 'when available';
        });
    });
});

checkBoxNewDomainStrictMode
    .addEventListener('click', function () {
        toggleNewDomainStrictMode.checked = !toggleNewDomainStrictMode.checked;
        if (toggleNewDomainStrictMode.checked) {
            lineNewDomainStrictMode.style.backgroundColor = '#48bb78';
            scionMode.innerHTML = 'strict';
        } else {
            lineNewDomainStrictMode.style.backgroundColor = '';
            scionMode.innerHTML = 'when available';
        }
    });

function updateProxyFormState(isAutoConfig: boolean) {
    const manualControls = document.querySelectorAll(
        '#manual-proxy-settings input, #manual-proxy-settings select, #manual-proxy-settings button, #reset-proxy-defaults'
    ) as NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>;
    
    manualControls.forEach(element => {
      element.disabled = isAutoConfig;
      if (isAutoConfig) {
        element.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        element.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });
    
    if (isAutoConfig) {
        const message: OnMessageMessageType = {action: "fetchAndApplyScionPAC"};
        browser.runtime.sendMessage(message);
    }
}

// Load saved settings
document.addEventListener('DOMContentLoaded', function() {
    getSyncValues({
        [PROXY_SCHEME]: "https",
        [PROXY_HOST]: "forward-proxy.scion",
        [PROXY_PORT]: "9443",
    }).then((items) => {
        proxySchemeElement.value = items[PROXY_SCHEME];
        proxyHostElement.value = items[PROXY_HOST];
        proxyPortElement.value = items[PROXY_PORT];
    });

    const saveProxySettingsButton = document.getElementById('save-proxy-settings') as HTMLButtonElement;
    const resetProxyDefaultsButton = document.getElementById('reset-proxy-defaults') as HTMLButtonElement;
    const autoProxyConfigInput = document.getElementById('auto-proxy-config') as HTMLInputElement;
    getSyncValue(AUTO_PROXY_CONFIG, true).then(autoProxyConfig => {
        autoProxyConfigInput.checked = autoProxyConfig;
        updateProxyFormState(autoProxyConfig);
    });

    saveProxySettingsButton.addEventListener('click', saveProxySettings);
    resetProxyDefaultsButton.addEventListener('click', resetProxyDefaults);
    autoProxyConfigInput.addEventListener('change', saveAutoProxyConfig);
});
  
function saveProxySettings() {
    const scheme = proxySchemeElement.value;
    const host = proxyHostElement.value;
    const port = proxyPortElement.value;

    // Basic validation
    if (!host || !port) {
        alert('Proxy host and port are required');
        return;
    }

    saveSyncValues({
        [PROXY_SCHEME]: scheme,
        [PROXY_HOST]: host,
        [PROXY_PORT]: port,
    }).then(() => {
        // Show saved message
        const saveButton = document.getElementById('save-proxy-settings') as HTMLButtonElement;
        const originalText = saveButton.textContent;
        saveButton.textContent = 'Settings Saved!';
        saveButton.disabled = true;

        setTimeout(function() {
            saveButton.textContent = originalText;
            saveButton.disabled = false;
        }, 1500);
    });
}
function resetProxyDefaults() {
    proxySchemeElement.value = DEFAULT_PROXY_SCHEME;
    proxyHostElement.value = DEFAULT_PROXY_HOST;
    proxyPortElement.value = DEFAULT_PROXY_PORT;
}

function saveAutoProxyConfig() {
    const autoProxyConfigInput = document.getElementById('auto-proxy-config') as HTMLInputElement;
    const autoConfig = autoProxyConfigInput.checked;

    saveSyncValue(AUTO_PROXY_CONFIG, autoConfig).then(() => updateProxyFormState(autoConfig));
}

/**
 * Converts a given array into its `Set` representation.
 * @typeParam T the type of item inside the array/set.
 * @param array the array to be converted into a set.
 */
function toSet<T>(array: T[]): Promise<Set<T>> {
    return new Promise(resolve => {
        resolve(new Set(array));
    });
}