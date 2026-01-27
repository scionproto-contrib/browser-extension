import {isHostScion} from "./background_helpers/request_interception_handler.js";
import {clearTabResources} from "./shared/storage.js";
import {safeHostname} from "./shared/utilities.js";
import {initializeProxyHandler} from "./background_helpers/proxy_handler.js";

const titleElement = document.getElementById("title") as HTMLHeadingElement;
const spinnerElement = document.getElementById("spinner") as HTMLDivElement;
const statusElement = document.getElementById('status') as HTMLParagraphElement;
const originalUrlElement = document.getElementById('original-url') as HTMLParagraphElement;

async function init() {
    await initializeProxyHandler();

    statusElement.textContent = 'Determining the original page you tried to open...';

    // extracting the original URL from the path (of the form `extension_path/checking.html#https://example.com`)
    let originalUrl = location.hash.slice(1);
    console.log('Original URL:', originalUrl);
    // this verification prevents possibly undefined behaviour in the proxy or exploitations such as `checking.html#javascript:alert(some_internal_value)`
    if (!originalUrl.startsWith("http://") && !originalUrl.startsWith("https://")) {
        statusElement.textContent = "Disallowing URLs that do not start with 'http' or 'https'";
        checkFinished();
        return;
    }
    if (!originalUrl) {
        statusElement.textContent = 'Could not determine the original URL: ' + originalUrl;
        checkFinished()
        return;
    }
    originalUrlElement.textContent = originalUrl;
    statusElement.textContent = 'Checking SCION compatibility for:';

    // extracting the hostname from the URL
    const host = safeHostname(originalUrl);
    if (host === null) {
        console.error('Invalid URL:', originalUrl);
        statusElement.textContent = 'Invalid original URL.';
        checkFinished()
        return;
    }

    // cannot be undefined, as the call is always made from a tab context
    const currentTab = (await chrome.tabs.getCurrent())!;
    // since a main_frame request switches the entire page to checking.html, it should be safe to assume the list of resources
    // requested by this tab can be overwritten
    // clearing the resources must be done here, as onBeforeRequest only handles it in non-globalStrictMode, this is in order
    // not to clear tab resources added via the isHostScion call below
    if (currentTab.id && currentTab.id >= 0) await clearTabResources(currentTab.id);
    const isScion = await isHostScion(host, host, currentTab.id !== undefined ? currentTab.id : chrome.tabs.TAB_ID_NONE);
    if (!isScion) {
        statusElement.textContent = "This page is NOT SCION-capable and was blocked in strict mode.";
        checkFinished()
        return;
    }

    checkFinished()
    statusElement.textContent = "This page is SCION-capable. Redirecting...";
    window.location.href = originalUrl; // performing the redirect back to the original URL after resolving it to be SCION-capable
}

function checkFinished() {
    spinnerElement.style.display = 'none';
    titleElement.textContent = "SCION Compatibility check finished"
}

init().catch((err) => {
    console.error('Error in checking.js init:', err);
    statusElement.textContent = 'Unexpected error in SCION checker. Try reloading the original URL or toggle strict mode off and on.';
});
