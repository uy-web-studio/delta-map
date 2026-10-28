// MapLibre runs its tile parsing in a Web Worker loaded from its own file. Bundlers don't
// pick that file up, so copy it into public/ where the static export serves it.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
