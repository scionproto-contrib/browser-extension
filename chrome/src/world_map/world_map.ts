const worldMapContainer = document.getElementById("world-map-container") as HTMLDivElement;

async function init() {
    // extracting the country codes from the path (of the form `extension_path/world_map.html#CH-DE-US`)
    const countryCodesAsString = location.hash.slice(1);
    const countryCodes = countryCodesAsString.split("-");
    console.log("[world_map.init]: Highlighting countries with codes: ", countryCodes);

    const response = await fetch("../../images/world.svg");
    worldMapContainer.innerHTML = await response.text();

    for (const countryCode of countryCodes) {
        const pathElements = document.getElementsByClassName(countryCode);
        for (const pathElement of pathElements) {
            pathElement.classList.add("highlight");
        }
    }
}

init().catch((err) => {
    console.error('Error in checking.js init:', err);
});
