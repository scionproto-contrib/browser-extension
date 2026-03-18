// section-specific initialization
import {getSyncValue, ISD_ALL, ISD_WHITELIST, saveSyncValue} from "../shared/storage.js";
import {removeEmptyEntries, toSet} from "../shared/utilities.js";

const allowAllTrafficCheckbox = document.getElementById("allow-all-traffic-checkbox") as HTMLInputElement;
const scionLabTable = document.getElementById("scion-lab-table") as HTMLTableElement;
const productionNetworkTable = document.getElementById("production-network-table") as HTMLTableElement;

// lists of ISDs; they will be sorted before displaying in the UI
const scionLabISDs: Record<string, string> = {
    "19": "EU",
    "17": "Switzerland",
    "18": "North America",
    "16": "AWS",
    "20": "Korea",
};
const productionNetworkISDs: Record<string, string> = {
    "64": "Switzerland",
    "65": "EU",
    "66": "Asia",
    "67": "North America",
    "70": "SSFN",
    "71": "SCIERA",
    "72": "HVR",
};

/**
 * Initializes event handlers and UI setup.
 */
export async function initializeGeofencing() {
    allowAllTrafficCheckbox.checked = await getSyncValue(ISD_ALL, true);
    allowAllTrafficCheckbox.addEventListener("click", allowAllTrafficCheckboxOnClick);

    const isdWhitelist = await getSyncValue(ISD_WHITELIST, []);
    updateScionLabTable(isdWhitelist);
    updateProductionNetworkTable(isdWhitelist);
}

/**
 * Populates the {@link scionLabTable}.
 */
function updateScionLabTable(isdWhitelist: string[]) {
    scionLabTable.innerHTML = "";

    const orderedScionLabISDNumbers = orderByISDNumber(Object.keys(scionLabISDs));
    for (const isdNumber of orderedScionLabISDNumbers) {
        const isdName = scionLabISDs[isdNumber];
        const isWhitelisted = isdWhitelist.includes(isdNumber);
        const elementId = getIsdElementId(isdNumber);

        scionLabTable.innerHTML += `
            <tr>
                <td>${isdNumber}</td>
                <td><label for="${elementId}">${isdName}</label></td>
                <td>
                    <input id="${elementId}" type="checkbox" class="toggle toggle-success" ${isWhitelisted ? "checked" : ""}/>
                </td>
            </tr>
        `;
    }

    // registering the onclick-handlers
    for (const isdNumber of orderedScionLabISDNumbers) {
        const elementId = getIsdElementId(isdNumber);
        const checkbox = document.getElementById(elementId);
        if (checkbox === null) console.log("[updateScionLabTable]: Failed to find element with isdNumber: ", isdNumber);
        checkbox?.addEventListener("click", async () => await isdCheckboxOnClick(isdNumber));
    }
}

/**
 * Populates the {@link productionNetworkTable}.
 */
function updateProductionNetworkTable(isdWhitelist: string[]) {
    productionNetworkTable.innerHTML = "";

    const orderedProductionNetworkISDNumbers = orderByISDNumber(Object.keys(productionNetworkISDs));
    for (const isdNumber of orderedProductionNetworkISDNumbers) {
        const isdName = productionNetworkISDs[isdNumber];
        const isWhitelisted = isdWhitelist.includes(isdNumber);
        const elementId = getIsdElementId(isdNumber);

        productionNetworkTable.innerHTML += `
            <tr>
                <td>${isdNumber}</td>
                <td><label for="${elementId}">${isdName}</label></td>
                <td>
                    <input id="${elementId}" type="checkbox" class="toggle toggle-success" ${isWhitelisted ? "checked" : ""}/>
                </td>
            </tr>
        `;

        const checkbox = document.getElementById(elementId);
        if (checkbox === null) console.log("[updateProductionNetworkTable]: Failed to find element with isdNumber: ", isdNumber);
        checkbox?.addEventListener("click", async () => await isdCheckboxOnClick(isdNumber));
    }

    // registering the onclick-handlers
    for (const isdNumber of orderedProductionNetworkISDNumbers) {
        const elementId = getIsdElementId(isdNumber);
        const checkbox = document.getElementById(elementId);
        if (checkbox === null) console.log("[updateScionLabTable]: Failed to find element with isdNumber: ", isdNumber);
        checkbox?.addEventListener("click", async () => await isdCheckboxOnClick(isdNumber));
    }
}

/**
 * Event handler function that is invoked when the whitelist preference of an ISD changes.
 * Saves the new value.
 */
async function isdCheckboxOnClick(isdNumber: string) {
    const elementId = getIsdElementId(isdNumber);
    const checkbox = document.getElementById(elementId) as HTMLInputElement;

    const isdList = await getSyncValue(ISD_WHITELIST, []);
    const isdSet = await toSet(removeEmptyEntries(isdList));
    if (checkbox.checked) {
        isdSet.add(isdNumber);
        console.log("Added isd to list: ", isdNumber);
    } else {
        isdSet.delete(isdNumber);
        console.log("Delete isd to list: ", isdNumber);
    }
    await saveSyncValue(ISD_WHITELIST, [...isdSet]);
    console.log([...isdSet]);
}

/**
 * Event handler function that is invoked when the allow-all-traffic preference changes.
 * Saves the new value.
 */
async function allowAllTrafficCheckboxOnClick() {
    await saveSyncValue(ISD_ALL, allowAllTrafficCheckbox.checked);
}

/**
 * Sorts the provided {@link isds} in ascending order under the assumption that the values are stringified numbers.
 */
function orderByISDNumber(isds: string[]) {
    return isds.sort((a, b) => Number(a) - Number(b));
}

/**
 * Returns the HTML element ID based on the {@link isdNumber}.
 */
function getIsdElementId(isdNumber: string) {
    return `ISD-${isdNumber}`;
}