/**
 * TypeScript type-file to get type-support for geojson-geometries-lookup (https://www.npmjs.com/package/geojson-geometries-lookup).
 */
declare module "geojson-geometries-lookup" {
    import { Feature, FeatureCollection, Geometry } from "geojson";

    export interface LookupOptions {
        ignorePoints?: boolean;
        ignoreLines?: boolean;
        ignorePolygons?: boolean;
        limit?: number;
    }

    export default class GeoJsonGeometriesLookup {
        constructor(geoJson: GeoJSON.GeoJSON, options?: LookupOptions);

        forEachContainer(
            geometry: Geometry,
            options?: LookupOptions,
            func?: (geom: Feature, index: number) => void
        ): number;

        getContainers(
            geometry: Geometry,
            options?: LookupOptions
        ): FeatureCollection;

        hasContainers(
            geometry: Geometry,
            options?: LookupOptions
        ): boolean;

        countContainers(
            geometry: Geometry,
            options?: LookupOptions
        ): number;
    }
}