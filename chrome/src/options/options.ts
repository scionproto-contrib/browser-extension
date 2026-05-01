import {initializeStrictModes} from "../shared/utilities.js";
import {initializeGeneral} from "./options_general.js";
import {initializeSitePreferences} from "./options_site_preferences.js";
import {initializeGeofencing} from "./options_geofencing.js";
import {initializeAdvanced} from "./options_advanced.js";

// initialization logic for values used by all sections/tabs
document.addEventListener('DOMContentLoaded', async () => {
    await initializeStrictModes();

    await initializeGeneral();
    await initializeSitePreferences();
    await initializeGeofencing();
    await initializeAdvanced();
});