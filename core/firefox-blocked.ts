import {initializeIsChromium, safeHostname} from "./shared/utilities.js";
import {addTabResource} from "./shared/storage.js";

const blockedUrlElement = document.getElementById("blocked-url") as HTMLParagraphElement;

async function init() {
    // initializing the value in the 'firefox-blocked'-context
    initializeIsChromium();

    const originalUrl = location.hash.slice(1);
    if (originalUrl) {
        blockedUrlElement.textContent = originalUrl;
    }

    const originalHostname = safeHostname(originalUrl);
    const currentTab = await browser.tabs.getCurrent();
    if (originalHostname === null || currentTab.id === undefined) return;

    await addTabResource(currentTab.id, originalHostname, false);
}
init().catch((err) => {
    console.error('Error in checking.js init:', err);
    blockedUrlElement.textContent = 'Unexpected error in BLOCKED page.';
});
