"use client";

import { useEffect, useRef } from "react";
import { GeolocateControl, Map as MlMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { colorFor, MAP_STYLE } from "@/lib/categories";
import { INK, PAPER, paperStyle } from "@/lib/paper";
import { bbox, centroid, spreadPins } from "@/lib/geo";
import type { Building, Pin } from "@/lib/types";
import type { Selection } from "./MapApp";

interface Props {
  boundary: Feature<Polygon>;
  buildings: Building[];
  pins: Pin[];
  eventCounts: Record<string, number>;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

// A building with more centroid-placed pins than this shows a count on its label instead of a
// ring of dots; filtering or searching brings the dots back once few enough match.
const MAX_FANNED = 4;

function crowdedBuildings(pins: Pin[]) {
  const counts = new Map<string, number>();
  for (const p of pins) if (p.approximate && p.location_id) counts.set(p.location_id, (counts.get(p.location_id) ?? 0) + 1);
  return new Map([...counts].filter(([, n]) => n > MAX_FANNED));
}

const hiddenIn = (p: Pin, crowded: Map<string, number>) => (p.approximate && p.location_id && crowded.has(p.location_id) ? p.location_id : null);

// Copied into public/ by scripts/copy-worker.mjs; must be an absolute URL for module workers.
setWorkerUrl(new URL(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/maplibre-gl-worker.mjs`, window.location.origin).href);

export default function CampusMap({ boundary, buildings, pins, eventCounts, selection, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const buildingData = () =>
    fc(buildings.map((b) => ({ ...b, properties: { ...b.properties, events: eventCounts[b.properties.location_id] ?? 0 } })));
  const labelData = () => {
    const crowded = crowdedBuildings(pins);
    return fc(
      buildings
        .filter((b) => b.properties.name !== "Unnamed building")
        .map((b) => {
          const id = b.properties.location_id, events = eventCounts[id] ?? 0, places = crowded.get(id);
          const label = [b.properties.name, events && `${events} today`, places && `${places} places`].filter(Boolean).join("\n");
          return { type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: centroid(b) } };
        }),
    );
  };
  const pinData = () => {
    const crowded = crowdedBuildings(pins);
    return fc(
      spreadPins(pins.filter((p) => !hiddenIn(p, crowded))).map((p) => ({
        type: "Feature",
        properties: { id: p.id, name: p.name, color: colorFor(p.category) },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      })),
    );
  };

  // The map is created after its style is fetched, so the load handler reads the latest data and
  // selection through these instead of the first render's closure.
  const latest = useRef({ buildingData, labelData, pinData });
  latest.current = { buildingData, labelData, pinData };
  const applySelection = useRef<() => void>(() => {});

  useEffect(() => {
    let m: MlMap | null = null;
    let cancelled = false;
    fetch(MAP_STYLE)
      .then((r) => r.json())
      .then((style) => !cancelled && create(paperStyle(style)));
    return () => {
      cancelled = true;
      ready.current = false;
      m?.remove();
    };

    function create(style: StyleSpecification) {
      const [w, s, e, n] = bbox(boundary.geometry.coordinates[0]);
      const padX = (e - w) * 0.6, padY = (n - s) * 0.6;
      m = new MlMap({
        container: container.current!,
        style,
        bounds: [w, s, e, n],
        fitBoundsOptions: { padding: 24 },
        maxBounds: [w - padX, s - padY, e + padX, n + padY],
        minZoom: 14,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      m.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "bottom-right");

      m.on("load", () => {
        const m = map.current!;
        const { buildingData, labelData, pinData } = latest.current;
        m.addSource("boundary", { type: "geojson", data: boundary });
        m.addSource("buildings", { type: "geojson", data: buildingData(), promoteId: "location_id" });
        m.addSource("labels", { type: "geojson", data: labelData() });
        m.addSource("pins", { type: "geojson", data: pinData() });

        m.addLayer({ id: "boundary", type: "line", source: "boundary", paint: { "line-color": INK, "line-width": 2, "line-dasharray": [2, 2] } });
        m.addLayer({
          id: "buildings-fill",
          type: "fill",
          source: "buildings",
          // Each building has its own color (scripts/building-colors.mjs); one with events today fills in more.
          paint: { "fill-color": ["coalesce", ["get", "color"], INK], "fill-opacity": ["case", [">", ["get", "events"], 0], 0.6, 0.28] },
        });
        m.addLayer({ id: "buildings-line", type: "line", source: "buildings", paint: { "line-color": ["coalesce", ["get", "color"], INK], "line-width": 1.5 } });
        m.addLayer({ id: "buildings-selected", type: "line", source: "buildings", filter: ["==", ["get", "location_id"], ""], paint: { "line-color": "#ffcb05", "line-width": 7 } });
        m.addLayer({ id: "buildings-selected-edge", type: "line", source: "buildings", filter: ["==", ["get", "location_id"], ""], paint: { "line-color": INK, "line-width": 2 } });
        m.addLayer({
          id: "labels",
          type: "symbol",
          source: "labels",
          minzoom: 15.5,
          layout: {
            "text-field": ["get", "label"],
            "text-size": 12,
            "text-font": ["Noto Sans Regular"],
            "text-max-width": 8,
            "text-anchor": "top",
            "text-offset": [0, 0.9],
          },
          paint: { "text-color": INK, "text-halo-color": PAPER, "text-halo-width": 1.5 },
        });
        m.addLayer({
          id: "pins",
          type: "circle",
          source: "pins",
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 5, 18, 9], "circle-color": ["get", "color"], "circle-stroke-color": PAPER, "circle-stroke-width": 2 },
        });
        m.addLayer({ id: "pins-selected", type: "circle", source: "pins", filter: ["==", ["get", "id"], ""], paint: { "circle-radius": 13, "circle-color": "#ffcb05", "circle-stroke-color": INK, "circle-stroke-width": 2 } }, "pins");

        // Pins sit on top of buildings, so check them first.
        m.on("click", (ev) => {
          const pin = m.queryRenderedFeatures(ev.point, { layers: ["pins"] })[0];
          if (pin) return onSelectRef.current({ kind: "pin", id: String(pin.properties.id) });
          const b = m.queryRenderedFeatures(ev.point, { layers: ["buildings-fill"] })[0];
          if (b) onSelectRef.current({ kind: "building", id: String(b.properties.location_id) });
        });
        for (const layer of ["pins", "buildings-fill"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        ready.current = true;
        applySelection.current();
      });
    }
    // Built once; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("buildings") as GeoJSONSource).setData(buildingData());
    (m.getSource("labels") as GeoJSONSource).setData(labelData());
    (m.getSource("pins") as GeoJSONSource).setData(pinData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, eventCounts]);

  useEffect(() => {
    applySelection.current = () => {
      const m = map.current!;
      const crowded = crowdedBuildings(pins);
      const picked = selection?.kind === "pin" ? pins.find((p) => p.id === selection.id) : undefined;
      // A pin folded into its building's count is shown by outlining the building.
      const buildingId = selection?.kind === "building" ? selection.id : picked ? hiddenIn(picked, crowded) : null;
      for (const id of ["buildings-selected", "buildings-selected-edge"]) m.setFilter(id, ["==", ["get", "location_id"], buildingId ?? ""]);
      m.setFilter("pins-selected", ["==", ["get", "id"], selection?.kind === "pin" ? selection.id : ""]);
      const target = buildingId ? buildings.find((b) => b.properties.location_id === buildingId) : null;
      const pin = !target && picked ? spreadPins(pins.filter((p) => !hiddenIn(p, crowded))).find((p) => p.id === picked.id) : null;
      const center = target ? centroid(target) : pin ? [pin.lng, pin.lat] : null;
      // Keep the target in the part of the map the detail sheet leaves visible.
      const wide = window.innerWidth >= 900;
      const padding = wide ? { right: 380, top: 0, bottom: 0, left: 0 } : { bottom: m.getContainer().clientHeight * 0.6, top: 0, left: 0, right: 0 };
      if (center) m.easeTo({ center: center as [number, number], zoom: Math.max(m.getZoom(), 17), padding });
    };
    if (ready.current) applySelection.current();
  }, [selection, buildings, pins]);

  return <div ref={container} className="map" role="region" aria-label="Campus map. The list view has the same places in text." />;
}
