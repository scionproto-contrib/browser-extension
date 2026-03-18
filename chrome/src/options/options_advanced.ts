import {
    DEFAULT_PROXY_HOST,
    fetchAndApplyScionPAC,
    HTTP_PROXY_SCHEME,
    HTTPS_PROXY_PORT,
    HTTPS_PROXY_SCHEME,
    loadProxySettingsNoUpdate,
    proxyHost,
    proxyPort,
    proxyScheme
} from "../background_helpers/proxy_handler.js";
import {AUTO_PROXY_CONFIG, getSyncValue, PROXY_HOST, PROXY_PORT, PROXY_SCHEME, saveSyncValue, saveSyncValues} from "../shared/storage.js";

// Default proxy configuration values
const DEFAULT_PROXY_SCHEME = HTTPS_PROXY_SCHEME;
const DEFAULT_PROXY_PORT = HTTPS_PROXY_PORT;

const proxyAutoConfigurationCheckbox = document.getElementById("proxy-auto-configuration-checkbox") as HTMLInputElement;
const proxySchemeSelect = document.getElementById("proxy-scheme-select") as HTMLSelectElement;
const proxyHostInput = document.getElementById("proxy-host-input") as HTMLInputElement;
const proxyPortInput = document.getElementById("proxy-port-input") as HTMLInputElement;
const proxySaveSettingsButtonStatus = document.getElementById("proxy-save-settings-button-status") as HTMLDivElement;
const proxyResetDefaultButtonStatus = document.getElementById("proxy-reset-default-button-status") as HTMLDivElement;
const proxySaveSettingsButton = document.getElementById("proxy-save-settings-button") as HTMLButtonElement;
const proxyResetDefaultButton = document.getElementById("proxy-reset-default-button") as HTMLButtonElement;

/**
 * Initializes event handlers and UI setup.
 */
export async function initializeAdvanced() {
    // generate the options for the proxy-scheme dropdown
    const httpsOption = new Option(HTTPS_PROXY_SCHEME.toUpperCase(), HTTPS_PROXY_SCHEME);
    const httpOption = new Option(HTTP_PROXY_SCHEME.toUpperCase(), HTTP_PROXY_SCHEME);
    proxySchemeSelect.options.add(httpsOption);
    proxySchemeSelect.options.add(httpOption);

    // initializing the proxy-configuration values displayed in the UI
    await updateProxyValues();

    const autoProxyConfig = await getSyncValue(AUTO_PROXY_CONFIG, true);
    proxyAutoConfigurationCheckbox.checked = autoProxyConfig;
    await updateManualProxyConfigurationForm(autoProxyConfig);

    // event handler registrations
    proxyAutoConfigurationCheckbox.addEventListener("click", proxyAutoConfigurationCheckboxOnClick);
    proxySaveSettingsButton.addEventListener("click", proxySaveSettingsButtonOnClick);
    proxyResetDefaultButton.addEventListener("click", proxyResetDefaultButtonOnClick);
}

/**
 * Updates the proxy-configuration values displayed in the UI based on the values in storage.
 */
async function updateProxyValues() {
    await loadProxySettingsNoUpdate();
    proxySchemeSelect.value = proxyScheme;
    proxyHostInput.value = proxyHost;
    proxyPortInput.value = proxyPort;
}

/**
 * Event handler function that is invoked when the value for proxy autoconfiguration is toggled.
 * Saves the new value and updates the manual configuration form via {@link updateManualProxyConfigurationForm}.
 */
async function proxyAutoConfigurationCheckboxOnClick() {
    const isChecked = proxyAutoConfigurationCheckbox.checked;
    await saveSyncValue(AUTO_PROXY_CONFIG, isChecked);
    await updateManualProxyConfigurationForm(isChecked);
}

async function proxySaveSettingsButtonOnClick() {
    const scheme = proxySchemeSelect.value;
    const host = proxyHostInput.value;
    const port = proxyPortInput.value;

    // basic validation
    if (!host || !port) {
        alert('Proxy host and port are required');
        return;
    }

    await saveSyncValues({
        [PROXY_SCHEME]: scheme,
        [PROXY_HOST]: host,
        [PROXY_PORT]: port,
    });

    // display confirmation message
    const originalText = proxySaveSettingsButton.textContent;
    proxySaveSettingsButton.textContent = "Settings Saved!";
    proxySaveSettingsButton.disabled = true;

    // ensure notification for screen reader users
    proxySaveSettingsButtonStatus.textContent = "";
    requestAnimationFrame(() => {
        proxySaveSettingsButtonStatus.textContent = "Settings Saved";
    });

    setTimeout(() => {
        proxySaveSettingsButton.textContent = originalText;
        proxySaveSettingsButton.disabled = false;
    }, 2500);
}

/**
 * Event handler function that resets the values in the manual configuration form to their defaults.
 */
function proxyResetDefaultButtonOnClick() {
    proxySchemeSelect.value = DEFAULT_PROXY_SCHEME;
    proxyHostInput.value = DEFAULT_PROXY_HOST;
    proxyPortInput.value = DEFAULT_PROXY_PORT;

    proxyResetDefaultButtonStatus.textContent = "";
    requestAnimationFrame(() => {
        proxyResetDefaultButtonStatus.textContent = "Form fields reset, values not saved yet";
    });
}

/**
 * Updates all form fields conditioned on the provided {@link autoProxyConfigEnabled}.
 */
async function updateManualProxyConfigurationForm(autoProxyConfigEnabled: boolean) {
    proxySchemeSelect.disabled = autoProxyConfigEnabled;
    proxyHostInput.disabled = autoProxyConfigEnabled;
    proxyPortInput.disabled = autoProxyConfigEnabled;
    proxySaveSettingsButton.disabled = autoProxyConfigEnabled;
    proxyResetDefaultButton.disabled = autoProxyConfigEnabled;

    if (autoProxyConfigEnabled) {
        await fetchAndApplyScionPAC();
        await updateProxyValues();
    }
}