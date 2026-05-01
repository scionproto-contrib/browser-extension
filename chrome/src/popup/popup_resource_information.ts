import {proxyAddress, proxyPathUsagePath} from "../background_helpers/proxy_handler.js";
import {GlobalStrictMode, PerSiteStrictMode} from "../shared/utilities.js";
import type {IsolationDomain} from "./isolation_domain.js";
import {asCoordinatesMap, getASName, toAutonomousSystem} from "./autonomous_system_utils.js";
import {getISDCountryFlagPath, getISDName, toIsolationDomain} from "./isolation_domain_utils.js";
import type {AutonomousSystem} from "./autonomous_system.js";
import {CountryCode} from "./country_code.js";
import {getCountryFromCoordinates} from "./country_code_utils.js";

// types
type PerDomainPathUsage = { Domain: string, Path: string[], Strategy: string };
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
// world map
const resourceInformationTabInput = document.getElementById("tab-website-information") as HTMLInputElement;
const worldMapLink = document.getElementById("world-map-link") as HTMLAnchorElement;
const worldMapContainer = document.getElementById("world-map-container") as HTMLDivElement;

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

    // since the zoom-function relies on the SVG having already been rendered, only call
    // it when the tab that contains the map is selected (otherwise, due to the tab being
    // "display: none", the SVG is not rendered and bounding box computations cannot be
    // performed)
    resourceInformationTabInput.addEventListener("change", () => {
        if (!resourceInformationTabInput.checked) return;
        requestAnimationFrame(() => zoomToHighlightedCountries());
    });
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
async function updatePathUsageVisuals(pathUsage: PerDomainPathUsage) {
    console.log("path usage: ", pathUsage);
    const isdNumbers: Set<number> = new Set(pathUsage.Path.map((v: string) => {
        const isd: string = v.split("-")[0];
        return Number.parseInt(isd);
    }));
    const isolationDomains = [...isdNumbers].map((isd: number) => toIsolationDomain(isd));
    const autonomousSystems = pathUsage.Path.map(v => toAutonomousSystem(v.split("-")[1]));

    pathUsageSite.textContent = pathUsage.Domain;
    pathUsageStrategy.textContent = pathUsage.Strategy;
    pathUsageISDs.innerHTML = isolationDomains.map((isolationDomain: IsolationDomain) => {
        return `
            <div class="flex flex-row space-x-2 items-center">
                <img style="height: 25px" src=${getISDCountryFlagPath(isolationDomain)} alt="Icon of ${getISDName(isolationDomain)}"/>
                <p>(${isolationDomain})</p>
            </div>
        `
    }).join("");
    pathUsagePath.innerHTML = autonomousSystems.map(as => `<p>${as} (${getASName(as)})</p>`).join("");

    const autonomousSystemsNoDuplicates = new Set(autonomousSystems);
    await updateWorldMap([...autonomousSystemsNoDuplicates]);
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

    for (const pathUsage of json) {
        console.log(pathUsage.Domain.split(":")[0])
        // we only expect one match
        if (hostname && pathUsage.Domain.split(":")[0] === hostname) {
            await updatePathUsageVisuals(pathUsage);
        }
    }

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

// ====================
// World Map
// ====================
async function updateWorldMap(autonomousSystems: AutonomousSystem[]) {
    const geoCoordinates = autonomousSystems.map(as => asCoordinatesMap[as]);
    const countryCodes = geoCoordinates.map(gc => getCountryFromCoordinates(gc));
    console.log("[updateWorldMap]: (Possibly unknown) countries found on path: ", countryCodes);

    // purging any duplicate or unknown countries, such that they don't appear in the URL
    const countryCodeSet = new Set(countryCodes);
    countryCodeSet.delete(CountryCode.UNKNOWN);
    countryCodeSet.delete(CountryCode.TO_BE_DETERMINED);
    const countryCodesNoDuplicates = [...countryCodeSet];
    console.log("[updateWorldMap]: Highlighting countries with codes: ", countryCodesNoDuplicates);

    // initializing the world-map-link
    const countryCodesAsString = countryCodesNoDuplicates.join("-");
    const url = chrome.runtime.getURL(`src/world_map/world_map.html#${countryCodesAsString}`);
    worldMapLink.addEventListener("click", async () => {
        await chrome.tabs.create({'url': url});
    });

    const response = await fetch("../../images/world.svg");
    worldMapContainer.innerHTML = await response.text();

    for (const countryCode of countryCodesNoDuplicates) {
        const pathElements = document.getElementsByClassName(countryCode);
        for (const pathElement of pathElements) {
            pathElement.classList.add("highlight");
        }
    }
}

/**
 * Zooms the map to highlighted countries while maintaining the original aspect ratio
 * and enforcing a minimum zoom level relative to the map's total size.
 *
 * @param paddingPercent extra space around the country (default 5%).
 * @param minWidthPercent the minimum width of the zoom window relative to the original map width (default 10%).
 */
function zoomToHighlightedCountries(paddingPercent = 0.05, minWidthPercent = 0.10) {
    const worldMapSvg = worldMapContainer.getElementsByTagName("svg")[0];
    const highlighted = worldMapSvg.querySelectorAll<SVGPathElement>("path.highlight");

    if (highlighted.length === 0) {
        return;
    }

    // get the original map dimensions and aspect ratio
    const originalViewBox = worldMapSvg.viewBox.baseVal;
    const mapAspectRatio = originalViewBox.width / originalViewBox.height;

    // calculate the raw bounding box of highlighted elements
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    highlighted.forEach((path) => {
        const boundingBox = path.getBBox();
        minX = Math.min(minX, boundingBox.x);
        minY = Math.min(minY, boundingBox.y);
        maxX = Math.max(maxX, boundingBox.x + boundingBox.width);
        maxY = Math.max(maxY, boundingBox.y + boundingBox.height);
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const centerX = minX + contentWidth / 2;
    const centerY = minY + contentHeight / 2;

    // add padding
    let finalWidth = contentWidth * (1 + paddingPercent * 2);
    let finalHeight = contentHeight * (1 + paddingPercent * 2);

    // enforce same aspect ratio as the original map by expanding the shorter dimension (never crop content)
    if (finalWidth / finalHeight > mapAspectRatio)
        finalHeight = finalWidth / mapAspectRatio;
    else
        finalWidth = finalHeight * mapAspectRatio;

    // ensure the map is not zoomed in too far (i.e. respect the minWidthPercent), otherwise users might lose their bearings
    // on the map if only the outline of a single country is visible
    const minAllowedWidth = originalViewBox.width * minWidthPercent;
    if (finalWidth < minAllowedWidth) {
        finalWidth = minAllowedWidth;
        // again, maintain the aspect ratio
        finalHeight = finalWidth / mapAspectRatio;
    }

    // use the center of the minimal bounding box around the countries to ensure that same center is kept after increasing
    // the bounding box
    const viewBoxX = centerX - finalWidth / 2;
    const viewBoxY = centerY - finalHeight / 2;

    worldMapSvg.setAttribute(
        "viewBox",
        `${viewBoxX} ${viewBoxY} ${finalWidth} ${finalHeight}`
    );
}