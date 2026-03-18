import {PerSiteStrictMode} from "../shared/utilities.js";
import {PER_SITE_STRICT_MODE, saveSyncValue} from "../shared/storage.js";

// table
const sitePreferencesTable = document.getElementById("site-preferences-table") as HTMLTableElement;

// elements used when adding a new site preference
const addSitePreferenceDomainInput = document.getElementById("add-site-preference-domain-input") as HTMLInputElement;
const addSitePreferenceCheckbox = document.getElementById("add-site-preference-checkbox") as HTMLInputElement;
const addSitePreferenceCheckboxDescription = document.getElementById("add-site-preference-checkbox-description") as HTMLParagraphElement;
const addSitePreferenceButton = document.getElementById("add-site-preference-button") as HTMLButtonElement;

/**
 * Initializes event handlers and UI setup.
 */
export async function initializeSitePreferences() {
    addSitePreferenceButton.addEventListener("click", addSitePreferenceButtonOnClick);
    addSitePreferenceCheckbox.addEventListener("click", addSitePreferenceCheckboxOnClick)

    await updateSitePreferencesTable();

    // execute once, to initialize the description of the checkbox
    addSitePreferenceCheckboxOnClick();
}

/**
 * Updates all values in the site-preferences table.
 */
async function updateSitePreferencesTable() {
    sitePreferencesTable.innerHTML = "";

    let siteIndex = 0;
    Object.keys(PerSiteStrictMode).forEach(site => {
        // adding the HTML
        const isStrict = PerSiteStrictMode[site];
        const elementId = getSitePreferenceId(siteIndex);
        sitePreferencesTable.innerHTML += `
        <tr>
            <td><label for="${elementId}">${site}</label></td>
            <td>
                <div class="toggle-container flex flex-row items-center">
                    <input id="${elementId}"
                           type="checkbox"
                           class="strict-mode-toggle toggle toggle-success" ${isStrict ? "checked" : ""}
                           aria-describedby="${elementId}-description"/>
                    <p id="${elementId}-description" class="ml-2 font-body text-nowrap">
                        ${isStrict ? "Strict" : "When available"}
                    </p>
                </div>
            </td>
        </tr>`

        siteIndex++;
    });

    // registering the onclick-handlers
    // Note: `siteIndex` now represents the number of table rows that were added
    for (let i = 0; i < siteIndex; i++) {
        const elementId = getSitePreferenceId(i);
        const checkbox = document.getElementById(elementId) as HTMLInputElement | null;
        if (checkbox === null) console.log("[updateSitePreferencesTable]: Failed to find element with index: ", i);
        checkbox?.addEventListener("click", async () => await sitePreferenceCheckboxOnClick(i));
    }
}

/**
 * Event handler function that is invoked when the preference for a site changes.
 * Saves the new value.
 */
async function sitePreferenceCheckboxOnClick(siteIndex: number) {
    const elementId = getSitePreferenceId(siteIndex);
    const checkbox = document.getElementById(elementId) as HTMLInputElement | null;
    if (checkbox === null) {
        console.log("[sitePreferenceCheckboxOnClick]: Failed to find element with ID: ", elementId);
        return;
    }

    const descriptionElement = document.getElementById(`${elementId}-description`) as HTMLParagraphElement;
    descriptionElement.textContent = checkbox.checked ? "Strict" : "When available";

    const site = Object.keys(PerSiteStrictMode)[siteIndex];
    PerSiteStrictMode[site] = checkbox.checked;
    await saveSyncValue(PER_SITE_STRICT_MODE, PerSiteStrictMode);
}

/**
 * Returns the ID of the site-preference input element with index {@link siteIndex}.
 */
function getSitePreferenceId(siteIndex: number) {
    return `table-domain-toggle-${siteIndex}`;
}

/**
 * Adds a new site-preference entry based on the values the user entered.
 *
 * Resets the values after saving them.
 */
async function addSitePreferenceButtonOnClick() {
    const domain = addSitePreferenceDomainInput.value;

    PerSiteStrictMode[domain] = addSitePreferenceCheckbox.checked;
    await saveSyncValue(PER_SITE_STRICT_MODE, PerSiteStrictMode);

    // reset the input values
    addSitePreferenceDomainInput.value = "";
    addSitePreferenceCheckbox.checked = false;

    await updateSitePreferencesTable();
}

/**
 * Updates the description describing the state of the toggle-button.
 */
function addSitePreferenceCheckboxOnClick() {
    if (addSitePreferenceCheckbox.checked)
        addSitePreferenceCheckboxDescription.textContent = "Strict";
    else
        addSitePreferenceCheckboxDescription.textContent = "When available";
}