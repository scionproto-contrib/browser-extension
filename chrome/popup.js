// Copyright 2024 ETH Zurich, Ovgu
'use strict';

const DEFAULT_PROXY_SCHEME = "https"
const DEFAULT_PROXY_HOST = "forward-proxy.scion";
const DEFAULT_PROXY_PORT = "9443";
const proxyPathUsagePath = "/path-usage"
const proxyHealthCheckPath = "/health"

const toggleRunning = document.getElementById('toggleRunning');
const checkboxRunning = document.getElementById('checkboxRunning');
const lineRunning = document.getElementById("lineRunning");
const scionmode = document.getElementById("scionmode");
const mainDomain = document.getElementById("maindomain");
const pathUsageContainer = document.getElementById("path-usage-container");
const scionModePreference = document.getElementById('scionModePreference');
const domainList = document.getElementById("domainlist");
const scionsupport = document.getElementById("scionsupport");
const proxyStatusMessage = document.getElementById('proxy-status-message');
const proxyHelpLink = document.getElementById('proxy-help-link');

let proxyAddress = `${DEFAULT_PROXY_SCHEME}://${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}`


var perSiteStrictMode = {};
var popupMainDomain = "";
var getRequestsDatabaseAdapter;

checkboxRunning.onclick = toggleExtensionRunning;

document.getElementById('button-options').addEventListener('click', function () {
    chrome.tabs.create({ 'url': 'chrome://extensions/?options=' + chrome.runtime.id });
});

// TODO: if there are some race conditions, add a startup
// function that is called manually after all scripts are loaded
// Let's later move to something that allows using imports and
// maybe even typescript, e.g. https://github.com/abhijithvijayan/web-extension-starter
(() => {
    const src = chrome.extension.getURL('database.js');
    import(src).then(req => {
        getRequestsDatabaseAdapter = req.getRequestsDatabaseAdapter;
        getStorageValue('perSiteStrictMode').then((val) => {
            perSiteStrictMode = val || {};
            loadRequestInfo();
        });

    })

})();

window.onload = function () {
    chrome.storage.sync.get({
        proxyScheme: DEFAULT_PROXY_SCHEME,
        proxyHost: DEFAULT_PROXY_HOST,
        proxyPort: DEFAULT_PROXY_PORT
      }, (items) => {
        let proxyScheme = items.proxyScheme;
        let proxyHost = items.proxyHost;
        let proxyPort = items.proxyPort;
        proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

        updatePathUsage();
        checkProxyStatus();
    });
    
}

const updatePathUsage = () => {
    pathUsageContainer.innerHTML = "";

    console.log("get path usage")
    fetch(`${proxyAddress}${proxyPathUsagePath}`, {
        method: "GET"
    }).then(response => {
        if (response.status === 200) {
            response.json().then(json => {
                console.log(json)
                const startIndex = 2; // The first indices are already used the parent container
                if (json.length === 0) {
                    pathUsageContainer.innerHTML = "<p>No path usage data available\n</p>" + "<p>Try to configure your own policies to have acces to path usage data (under <i>Manage Preferences</i>).</p>";
                    return;
                }
                json.forEach((pathUsage, i) => {
                    let pathUsageChild = newPathUsageChild(pathUsage, i + startIndex);
                    console.log(pathUsageChild)
                    pathUsageContainer.innerHTML += pathUsageChild
                })
                console.log(pathUsageContainer.innerHTML)
            });
        }
    });

};

function checkProxyStatus() {
    proxyStatusMessage.textContent = "Checking proxy status...";
    proxyHelpLink.classList.add('hidden');
    
    fetch(`${proxyAddress}${proxyHealthCheckPath}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000)
    }).then(response => {
        if (response.status === 200) {
            proxyStatusMessage.textContent = "Proxy is connected";
            proxyStatusMessage.innerHTML += " <span>&#x2705;</span> ";
            // Hide the help link when everything is working
            proxyHelpLink.classList.add('hidden');
        } else {
            // Show error message for non-200 responses
            proxyStatusMessage.textContent = `Proxy connection error: ${response.status}`;
            proxyStatusMessage.innerHTML += " <span>#x274C;</span> ";
            showProxyHelpLink();
        }
    }).catch(error => {
        // Handle network errors or timeouts
        console.error("Proxy check failed:", error);
        proxyStatusMessage.textContent = "Failed to connect to proxy";
        proxyStatusMessage.innerHTML += " <span>&#x274C;</span> ";
        showProxyHelpLink();
    });
}


function showProxyHelpLink() {
    proxyHelpLink.classList.remove('hidden');
    proxyHelpLink.href = chrome.runtime.getURL('proxy-help.html');
    
    proxyHelpLink.addEventListener('click', function(event) {
        event.preventDefault();
        chrome.tabs.create({ url: this.href });
    });
}

const newPathUsageChild = (pathUsage, index) => {
    // This is at the moment just for presentation purposes and needs to be
    // rewritten in the end...
    console.log("path usage: ", pathUsage)
    const isds = new Set(pathUsage.Path.map(v => v.split("-")[0]));
    const flagMap = {
        "EU": "images/european-union.png",
        "CH": "images/switzerland.png",
        "AWS": "images/amazon.png",
        "US": "images/united-states.png",
        "JP": "images/japan.png",
        "TW": "images/taiwan.png",
        "CN": "images/china.png",
        "KR": "images/south-korea.png",
        "KREONET": "images/south-korea.png",
        "AS": "images/asia.png",
        "NA": "images/north-america.png",
        "SSFN": "images/switzerland.png",
        "SCIREN": "images/scion-0.png",
        "HVR": "images/hin.png",
        "RESERVED": "images/unknown.png",
        "UNKNOWN": "images/unknown.png",
    }

    return (`
<div class="ac-sub">
    <input class="ac-input" id="ac-${index}" name="ac-${index}" type="checkbox" />
    <label class="ac-label" for="ac-${index}">${pathUsage.Domain}</label>
    <article class="ac-sub-text">
        <p><b>Strategy:</b>${pathUsage.Strategy}</p>
        <p><b>ISDs:</b></p>

        <div class="flag-container">
        ${[...isds].map(isd =>
        `<div class="flag">
                <img src=${flagMap[returnCountryCode(isd)]}>
                <div class="description">
                    <p>(${returnCountryCode(isd)})</p>
                </div>
            </div>
        `).join("")}
        </div>
       
        <div class="ac-sub">
          <input class="ac-input" id="ac-${index}-path" name="ac-${index}-path" type="checkbox" />
          <label class="ac-label" for="ac-${index}-path"><b>Path:</b></label>
          <article class="ac-sub-text">
           ${pathUsage.Path.map(ia =>
            `<div><p>${ia}</p></div>`
        ).join("")}
          </article >
        </div >
    </article >
</div > `)
}

function humanFileSize(bytes, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


    return bytes.toFixed(dp) + ' ' + units[u];
}

function returnCountryCode(isd) {
    const isdMap = {
        // Assignments used by SCIONLab
        19: "EU",
        17: "CH",
        16: "AWS",
        18: "US",
        21: "JP",
        22: "TW",
        25: "CN",
        20: "KR",
        26: "KREONET",
        // Assignments used by the production network
        64: "CH",
        65: "EU",
        66: "AS",
        67: "NA",
        68: "RESERVED",
        69: "RESERVED",
        70: "SSFN",
        71: "SCIREN",
        72: "HVR"
    }
    let code = isdMap[isd];
    if (code === undefined) {
        return "UNKNOWN"
    }
    return code
}

// Start/Stop global forwarding
function toggleExtensionRunning() {
    toggleRunning.checked = !toggleRunning.checked;
    const newPerSiteStrictMode = {
        ...perSiteStrictMode,
        [popupMainDomain]: toggleRunning.checked,
    };

    if (toggleRunning.checked) {
        mainDomain.innerHTML = "SCION preference for " + popupMainDomain;
        toggleRunning.classList.remove("halfchecked");
        lineRunning.style.backgroundColor = "#48bb78";
        scionmode.innerHTML = "Strict";
    } else {
        mainDomain.innerHTML = "SCION preference for " + popupMainDomain;
        toggleRunning.classList.add("halfchecked");
        lineRunning.style.backgroundColor = "#cccccc";
        scionmode.innerHTML = "When available";
    }

    saveStorageValue('perSiteStrictMode', newPerSiteStrictMode).then(() => {
        perSiteStrictMode = newPerSiteStrictMode;
    });

}

async function loadRequestInfo() {
    const databaseAdapter = await getRequestsDatabaseAdapter();

    const checkedDomains = [];
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        var activeTab = tabs[0];
        var activeTabId = activeTab.id; // or do whatever you need
        const url = new URL(activeTab.url);
        popupMainDomain = url.hostname;

        let requests = await databaseAdapter.get({ mainDomain: url.hostname }, true);
        const mainDomainSCIONEnabled = requests.find(r => r.tabId === activeTabId && r.domain === url.hostname && r.scionEnabled);

        if (perSiteStrictMode[url.hostname]) {
            mainDomain.innerHTML = "SCION preference for " + url.hostname;
            toggleRunning.checked = true; // true
            toggleRunning.classList.remove("halfchecked");
            lineRunning.style.backgroundColor = "#48bb78";
            scionmode.innerHTML = "Strict";
        } else if (mainDomainSCIONEnabled) {
            mainDomain.innerHTML = "SCION preference for " + url.hostname;
            toggleRunning.checked = false; // true
            toggleRunning.classList.add("halfchecked");
            lineRunning.style.backgroundColor = "#cccccc";
            scionmode.innerHTML = "When available";
        } else {
            scionModePreference.style.display = "none";
        }// TODO: Else case would be no SCION... toggleRunning.checked = false;
        requests = requests.filter(r => r.tabId === activeTabId);
        console.log(requests);
        let mixedContent = false;

        for (let i = requests.length - 1; i >= 0; i--) {
            const r = requests[i];
            if (!checkedDomains.find(d => d === r.domain)) {
                checkedDomains.push(r.domain);
                let p = document.createElement("p");
                p.style.fontSize = "14px"
                if (r.scionEnabled) {
                    p.innerHTML = "<span>&#x2705;</span> " + r.domain;
                } else {
                    mixedContent = true;
                    p.innerHTML = "<span>&#x274C;</span> " + r.domain;
                }

                domainList.appendChild(p);
            }
        }
        requests.forEach(r => {
            if (!checkedDomains.find(d => d === r.domain)) {
                checkedDomains.push(r.domain);
                const sEnabled = requests.find(r2 => r.domain === r2.domain && r2.scionEnabled);
                let p = document.createElement("p");
                p.style.fontSize = "14px"
                if (sEnabled) {
                    p.innerHTML = "<span>&#x2705;</span> " + r.domain;
                } else {
                    mixedContent = true;
                    p.innerHTML = "<span>&#x274C;</span> " + r.domain;
                }

                domainList.appendChild(p);
            }
        });

        if (mainDomainSCIONEnabled) {
            if (mixedContent) {
                scionsupport.innerHTML = "Not all resources loaded via SCION";
            } else {
                scionsupport.innerHTML = "All resources loaded via SCION";
            }
        } else {
            scionsupport.innerHTML = "No resourced loaded via SCION";
        }
    });

}

