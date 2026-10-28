import type { StyleSpecification } from "maplibre-gl";

// The base map recolored as a paper map: cream ground, sepia roads and ink-brown labels. Every
// building drawn on top must contrast with PAPER (scripts/building-colors.mjs checks 3:1).
export const PAPER = "#f4ecd8";
export const INK = "#3b2f26";

// Positron is all greys; re-tint each grey at its own lightness so roads, parks and casings keep
// their relative weight.
function lightness(color: string): number | null {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  const hsl = color.match(/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/i);
  if (hsl) return Number(hsl[1]);
  let c: number[] | null = null;
  if (rgb) c = rgb.slice(1, 4).map(Number);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return c ? ((Math.max(...c) + Math.min(...c)) / 2 / 255) * 100 : null;
}

const alpha = (color: string) => color.match(/^(?:rgba|hsla)\(.*,\s*([\d.]+)\s*\)$/i)?.[1] ?? "1";

function tint(color: unknown, hue: number, sat: number): unknown {
  if (typeof color !== "string") return color;
  const l = lightness(color);
  return l === null ? color : `hsla(${hue}, ${sat}%, ${Math.round(l * 0.97)}%, ${alpha(color)})`;
}

export function paperStyle(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((layer) => {
    const paint = { ...(layer as { paint?: Record<string, unknown> }).paint };
    const water = layer.id.startsWith("water");
    for (const key of Object.keys(paint)) {
      if (!key.endsWith("color")) continue;
      if (layer.type === "background") paint[key] = PAPER;
      else if (key === "text-halo-color") paint[key] = PAPER;
      else if (key === "text-color") paint[key] = water ? "#4a6670" : INK;
      else paint[key] = water ? tint(paint[key], 190, 18) : tint(paint[key], 40, layer.id.match(/park|wood/) ? 28 : 38);
    }
    return { ...layer, paint } as typeof layer;
  });
  return { ...style, layers };
}
