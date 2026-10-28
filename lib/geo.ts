import type { Building, Pin } from "./types";

type Ring = number[][];

function ringCentroid(ring: Ring): [number, number, number] {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  return area ? [Math.abs(area), cx / (6 * area), cy / (6 * area)] : [0, ring[0][0], ring[0][1]];
}

// Same rule as scripts/geo.py: centroid of the largest outer ring.
export function centroid(b: Building): [number, number] {
  const polys = b.geometry.type === "Polygon" ? [b.geometry.coordinates] : b.geometry.coordinates;
  const best = polys.map((p: Ring[]) => ringCentroid(p[0])).reduce((a, c) => (c[0] > a[0] ? c : a));
  return [best[1], best[2]];
}

export function bbox(ring: Ring): [number, number, number, number] {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Pins placed at a building's centroid would stack on one spot; fan them out in a small ring
// (about 10 m) so each stays tappable. Pins with their own coordinates are left alone.
export function spreadPins(pins: Pin[]): Pin[] {
  const groups = new Map<string, Pin[]>();
  for (const p of pins) if (p.approximate && p.location_id) groups.set(p.location_id, [...(groups.get(p.location_id) ?? []), p]);
  const moved = new Map<string, [number, number]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((p, i) => {
      const a = (2 * Math.PI * i) / group.length;
      moved.set(p.id, [p.lng + 0.00011 * Math.cos(a), p.lat + 0.00009 * Math.sin(a)]);
    });
  }
  return pins.map((p) => (moved.has(p.id) ? { ...p, lng: moved.get(p.id)![0], lat: moved.get(p.id)![1] } : p));
}

export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
