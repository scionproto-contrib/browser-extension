import {proxyAddress, proxyPathUsagePath} from "../background_helpers/proxy_handler.js";
import {getASName, getCountryCode, getCountryName, getFlagPath, type PerDomainPathUsage} from "./popup_helper.js";
import {GlobalStrictMode, PerSiteStrictMode} from "../shared/utilities.js";

// types
type ProxyPathUsageResponse = PerDomainPathUsage[];

// references to containers to inform the user if no information is available
const websiteInformationContainer = document.getElementById("website-information-container") as HTMLDivElement;
const noWebsiteInformationContainer = document.getElementById("no-website-information-container") as HTMLDivElement;

const resourcesLoadedTitle = document.getElementById("popup-title") as HTMLHeadingElement;
const domainList = document.getElementById("domain-list") as HTMLDivElement;

// path usage
const pathUsageSite = document.getElementById("path-usage-site") as HTMLSpanElement;
const pathUsageStrategy = document.getElementById("path-usage-strategy") as HTMLSpanElement;
const pathUsageISDs = document.getElementById("path-usage-ISDs") as HTMLDivElement;
const pathUsagePath = document.getElementById("path-usage-path") as HTMLDivElement;
const noPathUsageAvailableContainer = document.getElementById("no-path-usage-available-container") as HTMLDivElement;
const pathUsageContainer = document.getElementById("path-usage-container") as HTMLDivElement;
const noPathUsageAvailable = document.getElementById("no-path-usage-available") as HTMLParagraphElement;

let hostname = "";

export async function initializeResourceAndPathInformation(_hostname: string, resources: [string, boolean][], mainDomainScionEnabled: boolean) {
    hostname = _hostname;

    // if no resources were loaded, inform the user and early-exit, since there cannot be any domains or path info available
    if (resources.length === 0) {
        websiteInformationContainer.classList.add("hidden");
        noWebsiteInformationContainer.classList.remove("hidden");
        return;
    }

    const allHostsScionCapable = await updateDomainList(resources);
    updateResourcesLoadedTitle(mainDomainScionEnabled, allHostsScionCapable);

    // update path usage for current domain
    await updatePathUsage();
}

/**
 * Updates the title that indicates the number of resources that were loaded/blocked
 * or loaded with/without SCION (depending on the site preference).
 */
function updateResourcesLoadedTitle(mainDomainScionEnabled: boolean, allHostsScionCapable: boolean) {
    if (PerSiteStrictMode[hostname] || GlobalStrictMode) {
        if (mainDomainScionEnabled) {
            if (allHostsScionCapable) {
                resourcesLoadedTitle.innerHTML = "All resources could be loaded";
            } else {
                resourcesLoadedTitle.innerHTML = "Strict mode prevented some resources from loading";
            }
        } else {
            resourcesLoadedTitle.innerHTML = "Strict mode blocked the page";
        }
    } else {
        if (mainDomainScionEnabled) {
            if (allHostsScionCapable) {
                resourcesLoadedTitle.innerHTML = "All resources loaded via SCION";
            } else {
                resourcesLoadedTitle.innerHTML = "Not all resources loaded via SCION";
            }
        } else {
            resourcesLoadedTitle.innerHTML = "No resources loaded via SCION";
        }
    }
}

/**
 * Updates the list of domains of all resources that were loaded during fetching of the page.
 *
 * Returns whether all hosts are SCION-capable.
 */
async function updateDomainList(resources: [string, boolean][]) {
    let allHostsScionCapable = true;
    domainList.innerHTML += resources.map(resource => {
        const domain = resource[0];
        const scionEnabled = resource[1];

        let svg: string;
        if (scionEnabled) {
            svg = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M4 12l4 4 8-8"/>
                </svg>
            `;
        } else {
            svg = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block h-4 w-4 stroke-current">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            `;
            allHostsScionCapable = false;
        }

        // adding a ':' before "allowed" and "blocked", such that the screen reader will enforce a pause between reading the domain name and the status
        // otherwise, e.g. with "ethz.ch allowed" the screen reader might read "ethz dot challowed", the latter being fused into a single word
        return `
            <div class="badge ${scionEnabled ? "badge-success" : "badge-error"} gap-2 pt-3 pb-3" >
                ${svg}${domain}
                <span class="sr-only">${scionEnabled ? ":allowed" : ":blocked"}</span>
            </div>
        `;
    }).join("");

    return allHostsScionCapable;
}

/**
 * Updates the information displayed in the path-menu.
 */
function updatePathUsageVisuals(pathUsage: PerDomainPathUsage) {
    console.log("path usage: ", pathUsage);
    const isds: Set<number> = new Set(pathUsage.Path.map((v: string) => {
        const isd: string = v.split("-")[0];
        return Number.parseInt(isd);
    }));

    pathUsageSite.textContent = pathUsage.Domain;
    pathUsageStrategy.textContent = pathUsage.Strategy;
    pathUsageISDs.innerHTML = [...isds].map((isd: number) => {
        const countryCode = getCountryCode(isd);
        return `
            <div class="flex flex-row space-x-2 items-center">
                <img style="height: 25px" src=${getFlagPath(countryCode)} alt="Icon of ${getCountryName(countryCode)}"/>
                <p>(${countryCode})</p>
            </div>
        `
    }).join("");
    pathUsagePath.innerHTML = pathUsage.Path.map(ia => `
        <p>${ia} (${getASName(ia.split("-")[1])})</p>
    `).join("");
}

async function updatePathUsage() {
    console.log("get path usage")
    pathUsagePath.innerHTML = "";

    const response = await fetch(`${proxyAddress}${proxyPathUsagePath}`, {method: "GET"});
    if (response.status !== 200) return;

    const res = await response.json();
    const json = res as ProxyPathUsageResponse;
    console.log(json)
    if (!json || json.length === 0) {
        showNoPathUsageAvailableMessage("No path usage data available");
        return;
    }

    json.forEach((pathUsage: PerDomainPathUsage) => {
        console.log(pathUsage.Domain.split(":")[0])
        // we only expect one match
        if (hostname && pathUsage.Domain.split(":")[0] === hostname) {
            updatePathUsageVisuals(pathUsage);
        }
    });

    if (pathUsagePath.innerHTML === "") {
        showNoPathUsageAvailableMessage("No path usage data available for current domain");
    }
}

/**
 * Reveals a text that informs the user that no path usage is available (exact text is specified by {@link message}).
 */
function showNoPathUsageAvailableMessage(message: string) {
    pathUsageContainer.classList.add("hidden");
    noPathUsageAvailableContainer.classList.remove("hidden");
    noPathUsageAvailable.textContent = message;
}