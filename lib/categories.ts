// Category colors are always paired with a text label in the UI, never the only signal.
export const CATEGORIES: Record<string, string> = {
  Food: "#c2410c",
  Housing: "#9333ea",
  "Health & wellness": "#be123c",
  "Academic support": "#1d4ed8",
  "Money & financial aid": "#047857",
  "Disability & access": "#0e7490",
  "Family & childcare": "#a16207",
  Veterans: "#4d7c0f",
  Transportation: "#475569",
  "Legal & immigration": "#7c3aed",
  "Tech access": "#0369a1",
  Safety: "#b91c1c",
  Events: "#db2777",
  "Student life": "#c026d3",
  "Career & jobs": "#0f766e",
  "Campus services": "#64748b",
  "Campus offices": "#94a3b8",
};

export const colorFor = (categories?: string[]) => CATEGORIES[categories?.[0] ?? ""] ?? "#475569";

// Free, keyless, cookieless OpenStreetMap vector tiles. Swap for a self-hosted PMTiles style later.
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
