// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// Copyright 2024 ETH Zurich
'use strict';

const toggleGlobalStrict = document.getElementById('toggleGlobalStrict');
const checkboxGlobalStrict = document.getElementById('checkboxGlobalStrict');
const lineStrictMode = document.getElementById('lineStrictMode');
const tableSitePreferences = document.getElementById('tableBodySitePreferences');
const checkBoxNewDomainStrictMode = document.getElementById('checkBoxNewDomainStrictMode');
const toggleNewDomainStrictMode = document.getElementById('toggleNewDomainStrictMode');
const lineNewDomainStrictMode = document.getElementById('lineNewDomainStrictMode');
const inputNewDomain = document.getElementById('inputNewDomain');
const scionMode = document.getElementById('scionmode');


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

window.onload = function () {
    getStorageValue('isd_whitelist').then((isdSet) => {
        displayToggleISD(isdSet);
    });
    getStorageValue('isd_all').then(value => {
        document.getElementById("allowAllTrafficToggle").checked = value
    });
    registerToggleISDHandler();
    registerToggleAllHandler();
}

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
    await saveStorageValue('isd_all', isdToggle.checked);
}


async function applyWhitelist(isd, checked) {
    const isdList = await getStorageValue('isd_whitelist');
    const isdSet = await toSet(removeEmptyEntries(isdList));
    if (checked) {
        isdSet.add(isd);
        console.log('Added isd to list: ' + isd);
    } else {
        isdSet.delete(isd);
        console.log('Delete isd to list: ' + isd);
    }
    const isdSet_1 = isdSet;
    await saveStorageValue('isd_whitelist', [...isdSet_1]);
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
    saveStorageValue('globalStrictMode', toggleGlobalStrict.checked);
}

getStorageValue('globalStrictMode').then(val => {
    toggleGlobalStrict.checked = val;
    if (toggleGlobalStrict.checked) {
        lineStrictMode.style.backgroundColor = '#48bb78';
    } else {
        lineStrictMode.style.backgroundColor = '#cccccc';
    }
});

function updateSitePreferences() {
    getStorageValue('perSiteStrictMode').then(perSiteStrictMode => {
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
    getStorageValue('perSiteStrictMode').then(val => {
        val[domain] = isdToggle.checked;
        saveStorageValue('perSiteStrictMode', val).then(() => {
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
        getStorageValue('perSiteStrictMode').then(val => {
            let perSiteStrictMode = {};
            if (val) {
                perSiteStrictMode = val;
            }
            perSiteStrictMode[domain] = strictMode;
            saveStorageValue('perSiteStrictMode', perSiteStrictMode).then(() => {
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