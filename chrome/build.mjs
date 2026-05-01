import { build } from "esbuild";

const ctx = await build({
    entryPoints: [
        "src/background.ts",
        "src/popup/popup.ts",
        "src/options/options.ts",
        "src/world_map/world_map.ts",
        "src/checking/checking.ts",
    ],
    bundle: true,
    outdir: "dist",
    outbase: ".",
    format: "esm",
    platform: "browser",
    target: "chrome114",
    sourcemap: true,
    logLevel: "info"
});
