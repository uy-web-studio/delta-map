// Gives every building in data/buildings.geojson its own color, picked by randoma11y to have at
// least 3:1 contrast (WCAG 1.4.11, graphics) against the paper base map. Colors are saved in each
// building's properties so they stay put between builds; only buildings without one get a new
// color, so run this after scripts/import_osm.py adds buildings.
//
//     node scripts/building-colors.mjs            # color new buildings
//     node scripts/building-colors.mjs --all      # recolor everything
import { readFileSync, writeFileSync } from "node:fs";
import { randoma11y } from "randoma11y";

const PAPER = "#f4ecd8"; // lib/paper.ts
const SELECTED = "#ffcb05"; // selection outline, Delta yellow
const FILE = new URL("../data/buildings.geojson", import.meta.url);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

const all = process.argv.includes("--all");
const fc = JSON.parse(readFileSync(FILE, "utf-8"));
const taken = all ? [] : fc.features.map((f) => f.properties.color).filter(Boolean);
let added = 0;
for (const f of fc.features) {
  if (f.properties.color && !all) continue;
  // Keep neighbors-by-chance apart and away from the selection yellow; relax if it gets crowded.
  let color, gap = 90;
  for (let tries = 0; ; tries++) {
    color = randoma11y({ color: PAPER, role: "background", algorithm: "WCAG21", threshold: 3 }).colors[1];
    if ([SELECTED, ...taken].every((c) => distance(c, color) >= gap)) break;
    if (tries % 50 === 49) gap -= 10;
  }
  f.properties.color = color;
  taken.push(color);
  added++;
}
writeFileSync(FILE, JSON.stringify(fc, null, 2) + "\n");
console.log(`${added} buildings colored, ${fc.features.length - added} kept`);
