// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// Copyright 2024 ETH Zurich, Ovgu
'use strict';

// Default proxy configuration values
import {getGlobalStrictMode, getIsdAll, getIsdWhitelist, getPerSiteStrictMode, saveGlobalStrictMode, saveIsdAll, saveIsdWhitelist, savePerSiteStrictMode} from "./shared/storage.js";

const DEFAULT_PROXY_SCHEME = 'https';
const DEFAULT_PROXY_HOST = 'forward-proxy.scion.ethz.ch';
const DEFAULT_PROXY_PORT = '9443';

const toggleGlobalStrict = document.getElementById('toggleGlobalStrict');
const checkboxGlobalStrict = document.getElementById('checkboxGlobalStrict');
const lineStrictMode = document.getElementById('lineStrictMode');
const tableSitePreferences = document.getElementById('tableBodySitePreferences');
const checkBoxNewDomainStrictMode = document.getElementById('checkBoxNewDomainStrictMode');
const toggleNewDomainStrictMode = document.getElementById('toggleNewDomainStrictMode');
const lineNewDomainStrictMode = document.getElementById('lineNewDomainStrictMode');
const inputNewDomain = document.getElementById('inputNewDomain');
const scionMode = document.getElementById('scionmode');
const proxySchemeElement = document.getElementById('proxy-scheme');
const proxyHostElement = document.getElementById('proxy-host');
const proxyPortElement = document.getElementById('proxy-port');


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
    const isdSet = await getIsdWhitelist();
    displayToggleISD(isdSet);

    document.getElementById("allowAllTrafficToggle").checked = await getIsdAll();

    registerToggleISDHandler();
    registerToggleAllHandler();
});

function displayToggleISD(isdSet) {
    if (!isdSet) {
        return;
    }
    for (const id of isdSet) {
        var isdToggle = document.getElementById(placeholderToggleID + id);
        if (isdToggle) {
            isdToggle.checked = true;
        }
    }
}

function registerToggleISDHandler() {
    const idsToggles = document.getElementsByClassName("isd-entry");
    for (let i = 0; i < idsToggles.length; i++) {
        const parentDiv = idsToggles[i].parentElement;
        parentDiv.onclick = () => {
            toggleISD(idsToggles[i].id);
        }
    }
};


function registerToggleAllHandler() {
    const allToggle = document.getElementById("allowAllTrafficToggle");
    console.log(allToggle)
    const parentDiv = allToggle.parentElement;
    parentDiv.onclick = () => {
        toggleAll(allToggle.id);
    }
};

function toggleISD(checked_id) {
    var isdToggle = document.getElementById(checked_id);
    isdToggle.checked = !isdToggle.checked;
    var id = checked_id.split("toggleISD-")[1];
    applyWhitelist(id, isdToggle.checked);
}

async function toggleAll(checked_id) {
    var isdToggle = document.getElementById(checked_id);
    isdToggle.checked = !isdToggle.checked;
    console.log(isdToggle.checked)
    await saveIsdAll(isdToggle.checked);
}


async function applyWhitelist(isd, checked) {
    const isdList = await getIsdWhitelist();
    const isdSet = await toSet(removeEmptyEntries(isdList));
    if (checked) {
        isdSet.add(isd);
        console.log('Added isd to list: ' + isd);
    } else {
        isdSet.delete(isd);
        console.log('Delete isd to list: ' + isd);
    }
    const isdSet_1 = isdSet;
    await saveIsdWhitelist([...isdSet_1]);
    console.log([...isdSet_1]);
}

function removeEmptyEntries(list) {
    if (!list) {
        return list;
    }
    return list.filter(l => !!l);
}

/* Optional Javascript to close the radio button version by clicking it again */
var myRadios = document.getElementsByName('tabs2');
var setCheck;
var x = 0;
for (x = 0; x < myRadios.length; x++) {
    myRadios[x].onclick = function () {
        if (setCheck != this) {
            setCheck = this;
        } else {
            this.checked = false;
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
    saveGlobalStrictMode(toggleGlobalStrict.checked);
}

getGlobalStrictMode().then(val => {
    toggleGlobalStrict.checked = val;
    if (toggleGlobalStrict.checked) {
        lineStrictMode.style.backgroundColor = '#48bb78';
    } else {
        lineStrictMode.style.backgroundColor = '#cccccc';
    }
});

function updateSitePreferences() {
    getPerSiteStrictMode().then(perSiteStrictMode => {
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
        const parentDiv = toggles[i].parentElement;
        parentDiv.onclick = () => {
            toggleSitePreference(toggles[i].id);
        }
    }
};

function toggleSitePreference(checked_id) {
    const isdToggle = document.getElementById(checked_id);
    isdToggle.checked = !isdToggle.checked;
    const domain = checked_id.split("toggleSite-")[1];
    getPerSiteStrictMode().then(val => {
        val[domain] = isdToggle.checked;
        savePerSiteStrictMode(val).then(() => {
            updateSitePreferences();
        });
    });
}

document.getElementById('checkboxGlobalStrict')
    .addEventListener('click', function () {
        toggleGlobalStrictMode();
    });

buttonAddHostname
    .addEventListener('click', function () {
        const domain = document.getElementById('inputNewDomain').value;
        const strictMode = !!toggleNewDomainStrictMode.checked;
        getPerSiteStrictMode().then(val => {
            let perSiteStrictMode = {};
            if (val) {
                perSiteStrictMode = val;
            }
            perSiteStrictMode[domain] = strictMode;
            savePerSiteStrictMode(perSiteStrictMode).then(() => {
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

function updateProxyFormState(isAutoConfig) {
    const manualControls = document.querySelectorAll('#manual-proxy-settings input, #manual-proxy-settings select, #manual-proxy-settings button, #reset-proxy-defaults');
    
    manualControls.forEach(element => {
      element.disabled = isAutoConfig;
      if (isAutoConfig) {
        element.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        element.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });
    
    if (isAutoConfig) {
      chrome.runtime.sendMessage({ action: "fetchAndApplyScionPAC" });
    }
}

// Load saved settings
document.addEventListener('DOMContentLoaded', function() {
    chrome.storage.sync.get({
      proxyScheme: 'https',
      proxyHost: 'forward-proxy.scion',
      proxyPort: '9443'
    }, function(items) {
      proxySchemeElement.value = items.proxyScheme;
      proxyHostElement.value = items.proxyHost;
      proxyPortElement.value = items.proxyPort;
    });

    chrome.storage.sync.get({
        autoProxyConfig: true
    }, function(items) {
        document.getElementById('auto-proxy-config').checked = items.autoProxyConfig;
        updateProxyFormState(items.autoProxyConfig);
    });
    
    document.getElementById('save-proxy-settings').addEventListener('click', saveProxySettings);
    document.getElementById('reset-proxy-defaults').addEventListener('click', resetProxyDefaults);
    document.getElementById('auto-proxy-config').addEventListener('change', saveAutoProxyConfig);

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

    chrome.storage.sync.set({
        proxyScheme: scheme,
        proxyHost: host,
        proxyPort: port
    }, function() {
        // Show saved message
        const saveButton = document.getElementById('save-proxy-settings');
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
    const autoConfig = document.getElementById('auto-proxy-config').checked;
    
    chrome.storage.sync.set({
      autoProxyConfig: autoConfig
    }, function() {
      updateProxyFormState(autoConfig);
    });
  }

function toSet(key) {
    return new Promise(resolve => {
        resolve(new Set(key));
    });
}