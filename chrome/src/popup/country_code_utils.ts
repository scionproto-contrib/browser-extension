import GeoJsonGeometriesLookup from "geojson-geometries-lookup";
import {CountryCode} from "./country_code.js";

export type GeoCoordinate =
    | { lat: number; lon: number; }
    | CountryCode.UNKNOWN
    | CountryCode.TO_BE_DETERMINED;

let lookup: GeoJsonGeometriesLookup | null = null;

export async function initializeCountryLookup(): Promise<void> {
    const response = await fetch(
        // map data sourced from https://geojson-maps.kyd.au/ (medium size, 50m)
        chrome.runtime.getURL("images/natural-earth-countries-50m.geojson")
    );

    const countries = await response.json();

    lookup = new GeoJsonGeometriesLookup(countries);
}

/**
 * Returns the {@link CountryCode} of the country in which the provided {@link coords} lie. If the
 * coordinates are {@link CountryCode.UNKNOWN} or {@link CountryCode.TO_BE_DETERMINED}, that same value
 * is returned.
 *
 * If the query fails to determine the country code, {@link CountryCode.UNKNOWN} is returned.
 */
export function getCountryFromCoordinates(coords: GeoCoordinate): CountryCode {
    if (coords === CountryCode.UNKNOWN || coords === CountryCode.TO_BE_DETERMINED) {
        return coords;
    }

    if (!lookup) {
        throw new Error("Country lookup not initialized");
    }

    const result = lookup.getContainers({
        type: "Point",
        coordinates: [coords.lon, coords.lat]
    });

    if (result.features.length === 0) {
        console.error("Country lookup failed to determine country for coordinates: ", coords);
        return CountryCode.UNKNOWN;
    }

    const code: string | null = result.features[0].properties?.iso_a2?.toUpperCase();
    if (code && code in CountryCode) {
        return CountryCode[code as keyof typeof CountryCode];
    }

    return CountryCode.UNKNOWN;
}