import {GlobalStrictMode} from "../shared/utilities.js";
import {GLOBAL_STRICT_MODE, saveSyncValue} from "../shared/storage.js";

// references to HTML elements
const globalStrictModeCheckbox = document.getElementById("global-strict-mode-checkbox") as HTMLInputElement;

/**
 * Initializes event handlers and UI setup.
 */
export async function initializeGeneral() {
    globalStrictModeCheckbox.checked = GlobalStrictMode;
    globalStrictModeCheckbox.addEventListener("click", globalStrictModeCheckboxOnClick);
}

async function globalStrictModeCheckboxOnClick() {
    await saveSyncValue(GLOBAL_STRICT_MODE, globalStrictModeCheckbox.checked);
}