import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MapData } from "./types";

// Read at build time only; the static export bakes these into the page.
const read = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "data", name), "utf-8"));

export function loadData(): MapData {
  return {
    boundary: read("boundary.geojson"),
    buildings: read("buildings.geojson").features,
    pins: read("pins.json"),
    events: read("events.json"),
    community: read("community.json"),
  };
}
