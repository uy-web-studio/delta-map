// Shapes of the files in data/, as written by scripts/sync.py and scripts/import_osm.py.
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type Hours = Partial<Record<Day, [string, string][]>>;
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface BuildingProps {
  location_id: string;
  name: string;
  osm?: string;
  color?: string; // from scripts/building-colors.mjs
}

export interface Building {
  type: "Feature";
  properties: BuildingProps;
  geometry: Polygon | MultiPolygon;
}

export interface CampusEvent {
  id: string;
  title: string;
  location_id: string;
  room?: string;
  start: string; // ISO 8601 with offset
  end: string;
  category?: string[];
  description?: string;
  url?: string;
  languages?: string[];
  source_url?: string;
  owner?: string;
}

export interface Resource {
  id: string;
  name: string;
  category?: string[];
  description?: string;
  hours?: Hours | null;
  hours_note?: string; // Delta's own wording when it isn't a plain weekly schedule
  eligibility?: string;
  phone?: string;
  email?: string;
  url?: string;
  languages?: string[];
  source_url?: string;
  owner?: string;
  lat?: number;
  lng?: number;
}

export interface Pin extends Resource {
  kind?: string;
  location_id?: string;
  room?: string;
  accessibility?: string;
  lat: number;
  lng: number;
  approximate: boolean; // true = placed at its building's centroid
}

export interface Community extends Resource {
  address?: string;
}

export interface MapData {
  boundary: Feature<Polygon>;
  buildings: Building[];
  pins: Pin[];
  events: CampusEvent[];
  community: Community[];
}
