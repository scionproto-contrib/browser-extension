import {PerSiteStrictMode} from "../shared/utilities.js";
import {PER_SITE_STRICT_MODE, saveSyncValue} from "../shared/storage.js";
import {proxyAddress, proxyHealthCheckPath} from "../background_helpers/proxy_handler.js";

// toggle-option for per-site strict mode of the current page
const togglePerSiteHostname = document.getElementById("toggle-per-site-hostname") as HTMLDivElement;
const togglePerSiteContainer = document.getElementById("toggle-per-site-container") as HTMLDivElement;
const togglePerSiteCheckbox = document.getElementById("toggle-per-site-checkbox") as HTMLInputElement;
const togglePerSiteMode = document.getElementById("toggle-per-site-mode") as HTMLParagraphElement;

// open options/preferences
const openOptionsButton = document.getElementById("open-options-button") as HTMLButtonElement;

// proxy status
const proxyContainer = document.getElementById("proxy-container") as HTMLDivElement;
const proxyStatusMessage = document.getElementById("proxy-status-message") as HTMLSpanElement;
const proxyHelpLink = document.getElementById("proxy-help-link") as HTMLAnchorElement;
const proxyDetailsContent = document.getElementById("proxy-details-content") as HTMLParagraphElement;

let hostname = "";

/**
 * Enum that represents the current status of the proxy.
 */
enum ProxyStatus {
    // Status determination has not finished yet
    Undetermined = 0,
    // HTTPS proxy was reached
    HTTPS = 1,
    // HTTPS proxy failed, but HTTP was reached
    HTTP = 2,
    // Both the HTTPS and HTTP proxy failed
    Failed = 3,
}

export async function initializeConfiguration(_hostname: string, resources: [string, boolean][], mainDomainScionEnabled: boolean) {
    hostname = _hostname;

    togglePerSiteCheckbox.addEventListener("click", togglePerSiteStrictModeOnClick);
    openOptionsButton.addEventListener("click", openOptionsButtonOnClick);

    // if no resources were loaded for the current tab, do not display the option to toggle per-site mode
    // this is the case if either the page is not a website, or the website was fetched from the browser's cache
    if (resources.length === 0) {
        togglePerSiteContainer.classList.add("hidden");
    }

    updateTogglePerSite(mainDomainScionEnabled);
    await checkProxyStatus();
}

/**
 * Updates values and information related to the toggle-button that toggles the current site's SCION preference.
 */
function updateTogglePerSite(mainDomainSCIONEnabled: boolean) {
    if (PerSiteStrictMode[hostname]) {
        togglePerSiteHostname.innerHTML = hostname;
        togglePerSiteCheckbox.checked = true;
        togglePerSiteMode.textContent = "Strict";
    } else if (mainDomainSCIONEnabled) {
        togglePerSiteHostname.innerHTML = hostname;
        togglePerSiteCheckbox.checked = false;
        togglePerSiteMode.textContent = "When available";
    } else {
        // page is not scion-capable, can therefore not be set to strict
        togglePerSiteContainer.style.display = "none";
    }
}

/**
 * Checks the current reachability of the proxy and updates the visuals via {@link updateProxyStatusVisuals} accordingly.
 */
async function checkProxyStatus() {
    updateProxyStatusVisuals(ProxyStatus.Undetermined);

    try {
        const response = await fetch(`${proxyAddress}${proxyHealthCheckPath}`, {
            method: "GET",
            signal: AbortSignal.timeout(2000)
        });
        if (response.status === 200) {
            if (proxyAddress.startsWith('https://')) {
                updateProxyStatusVisuals(ProxyStatus.HTTPS);
            } else {
                updateProxyStatusVisuals(ProxyStatus.HTTP);
            }
            proxyDetailsContent.textContent = `Proxy at ${proxyAddress}`;
        } else {
            updateProxyStatusVisuals(ProxyStatus.Failed);

            // Show error message for non-200 responses
            console.warn("Proxy check failed:", response.status);
        }
    } catch (error) {
        updateProxyStatusVisuals(ProxyStatus.Failed);

        // Handle network errors or timeouts
        console.warn("Proxy check failed:", error);
    }
}

/**
 * Updates the UI based on the provided {@link proxyStatus}.
 */
function updateProxyStatusVisuals(proxyStatus: ProxyStatus) {
    const alertError = "alert-error";
    const alertWarning = "alert-warning";
    const alertSuccess = "alert-success";
    const backgroundGray = "bg-gray-300";

    switch (proxyStatus) {
        case ProxyStatus.Undetermined:
            proxyStatusMessage.textContent = "Checking proxy status...";
            proxyHelpLink.classList.add('hidden');

            proxyContainer.classList.remove(alertError, alertWarning, alertSuccess);
            proxyContainer.classList.add(backgroundGray);
            break;
        case ProxyStatus.HTTPS:
            proxyStatusMessage.textContent = "Connected to proxy via HTTPS";
            proxyHelpLink.classList.add('hidden');

            proxyContainer.classList.remove(alertError, alertWarning, backgroundGray);
            proxyContainer.classList.add(alertSuccess);
            break;
        case ProxyStatus.HTTP:
            proxyStatusMessage.textContent = "Connected to proxy via HTTP. Check help to connect via HTTPS.";

            proxyContainer.classList.remove(alertError, alertSuccess, backgroundGray);
            proxyContainer.classList.add(alertWarning);

            showProxyHelpLink();
            break;
        case ProxyStatus.Failed:
            proxyStatusMessage.textContent = "Failed to connect to proxy";
            proxyDetailsContent.textContent = `Proxy at ${proxyAddress}`;

            proxyContainer.classList.remove(alertWarning, alertSuccess, backgroundGray);
            proxyContainer.classList.add(alertError);

            showProxyHelpLink();
            break;
    }

    // handling display of icon
    for (let i = 0; i < 4; i++) {
        document.getElementById(`proxy-icon-${i}`)?.classList.add("hidden");
    }
    document.getElementById(`proxy-icon-${<number>proxyStatus}`)?.classList.remove("hidden");
}

/**
 * Reveals a link that leads the user to the proxy-help page.
 */
function showProxyHelpLink() {
    proxyHelpLink.classList.remove('hidden');
    proxyHelpLink.href = chrome.runtime.getURL('proxy-help.html');

    proxyHelpLink.addEventListener('click', function (event) {
        event.preventDefault();
        chrome.tabs.create({url: this.href});
    });
}

/**
 * Toggles the per-site strict-mode value for the currently open site.
 */
async function togglePerSiteStrictModeOnClick() {
    const newPerSiteStrictMode = {
        ...PerSiteStrictMode,
        [hostname]: togglePerSiteCheckbox.checked,
    };

    if (togglePerSiteCheckbox.checked) {
        togglePerSiteHostname.innerHTML = hostname;
        togglePerSiteMode.innerHTML = "Strict";
    } else {
        togglePerSiteHostname.innerHTML = hostname;
        togglePerSiteMode.innerHTML = "When available";
    }

    await saveSyncValue(PER_SITE_STRICT_MODE, newPerSiteStrictMode);
}

/**
 * Opens the options page in a new tab.
 */
async function openOptionsButtonOnClick() {
    await chrome.runtime.openOptionsPage();
}