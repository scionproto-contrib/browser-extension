import {isHostScion} from "./background_helpers/request_interception_handler.js";

const titleElement = document.getElementById("title");
const spinnerElement = document.getElementById("spinner");
const statusElement = document.getElementById('status');
const originalUrlElement = document.getElementById('original-url');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function init() {
    statusElement.textContent = 'Determining the original page you tried to open...';

    // extracting the original URL from the path (of the form `extension_path/checking.html#https://example.com`)
    let originalUrl = location.hash.slice(1);
    console.log('Original URL:', originalUrl);
    if (!originalUrl) {
        statusElement.textContent = 'Could not determine the original URL: ' + originalUrl;
        checkFinished()
        return;
    }
    originalUrlElement.textContent = originalUrl;
    statusElement.textContent = 'Checking SCION compatibility for:';

    // TODO: remove this after testing (fake delay to verify checking.html page is working) and its related 'sleep' helper function
    await sleep(2000);

    // extracting the hostname from the URL
    let host;
    try {
        host = new URL(originalUrl).hostname;
    } catch (e) {
        console.error('Invalid URL:', e);
        statusElement.textContent = 'Invalid original URL.';
        checkFinished()
        return;
    }

    const currentTab = await chrome.tabs.getCurrent();
    const isScion = await isHostScion(host, currentTab.id);
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
