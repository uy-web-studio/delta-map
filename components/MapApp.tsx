"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, colorFor } from "@/lib/categories";
import { centroid, directionsUrl } from "@/lib/geo";
import { formatClock, formatEventTime, hoursSummary, isThisWeek, isToday, isUpcoming, openUntil } from "@/lib/time";
import type { Building, CampusEvent, Community, MapData, Pin } from "@/lib/types";

const CampusMap = dynamic(() => import("./CampusMap"), { ssr: false, loading: () => <div className="map" /> });

export type Selection = { kind: "building" | "pin" | "community"; id: string };

// Google Form links, set at build time. "{id}" is replaced with the pin or building id.
const REPORT_FORM = process.env.NEXT_PUBLIC_REPORT_FORM_URL ?? "";
const SUGGEST_FORM = process.env.NEXT_PUBLIC_SUGGEST_FORM_URL ?? "";

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const sel: Selection | null = q.get("loc")
    ? { kind: "building", id: q.get("loc")! }
    : q.get("pin")
      ? { kind: "pin", id: q.get("pin")! }
      : null;
  return { sel, cat: q.get("cat"), view: q.get("view") === "list" ? "list" : "map" } as const;
}

function writeUrl(sel: Selection | null, cat: string | null, view: string) {
  const q = new URLSearchParams();
  if (sel?.kind === "building") q.set("loc", sel.id);
  if (sel?.kind === "pin") q.set("pin", sel.id);
  if (cat) q.set("cat", cat);
  if (view === "list") q.set("view", "list");
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

const matches = (query: string, ...fields: (string | string[] | undefined)[]) =>
  !query || fields.flat().some((f) => f?.toLowerCase().includes(query));

export default function MapApp({ data }: { data: MapData }) {
  const [now, setNow] = useState<Date | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [openNow, setOpenNow] = useState(false);
  const [thisWeek, setThisWeek] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loaded, setLoaded] = useState(false);

  // "Now" only exists in the browser; the static HTML renders without time-based badges.
  useEffect(() => {
    const u = readUrl();
    setSelection(u.sel);
    setCat(u.cat && u.cat in CATEGORIES ? u.cat : null);
    setView(u.view);
    setNow(new Date());
    setLoaded(true);
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (loaded) writeUrl(selection, cat, view);
  }, [selection, cat, view, loaded]);

  const buildingsById = useMemo(() => new Map(data.buildings.map((b) => [b.properties.location_id, b])), [data.buildings]);
  const nameOf = (loc?: string) => (loc ? buildingsById.get(loc)?.properties.name : undefined);
  const q = query.trim().toLowerCase();

  const events = useMemo(
    () =>
      data.events.filter(
        (e) =>
          (!now || (thisWeek ? isThisWeek(e, now) : isUpcoming(e, now))) &&
          (!cat || e.category?.includes(cat)) &&
          matches(q, e.title, e.description, e.owner, nameOf(e.location_id)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.events, now, thisWeek, cat, q],
  );
  const pins = useMemo(
    () =>
      data.pins.filter(
        (p) =>
          (!cat || p.category?.includes(cat)) &&
          (!openNow || (now && openUntil(p.hours, now))) &&
          matches(q, p.name, p.description, p.owner, p.room, nameOf(p.location_id)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.pins, cat, openNow, now, q],
  );
  const community = useMemo(
    () =>
      data.community.filter(
        (c) => (!cat || c.category?.includes(cat)) && (!openNow || (now && openUntil(c.hours, now))) && matches(q, c.name, c.description, c.owner),
      ),
    [data.community, cat, openNow, now, q],
  );
  const eventCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (now) for (const e of data.events) if (isToday(e, now)) counts[e.location_id] = (counts[e.location_id] ?? 0) + 1;
    return counts;
  }, [data.events, now]);

  const usedCategories = useMemo(() => {
    const used = new Set([...data.pins, ...data.events, ...data.community].flatMap((r) => r.category ?? []));
    return Object.keys(CATEGORIES).filter((c) => used.has(c));
  }, [data]);

  return (
    <div className="app">
      <header className="top">
        <div className="title-row">
          <h1>Delta Community Map</h1>
          <div className="view-toggle" role="group" aria-label="View">
            <button aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
          </div>
        </div>
        <input
          type="search"
          className="search"
          placeholder="Search places, offices, events"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Filters">
          <button className="chip" aria-pressed={openNow} onClick={() => setOpenNow(!openNow)}>Open now</button>
          <button className="chip" aria-pressed={thisWeek} onClick={() => setThisWeek(!thisWeek)}>This week</button>
          {usedCategories.map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
              <span className="dot" style={{ background: CATEGORIES[c] }} aria-hidden />
              {c}
            </button>
          ))}
        </div>
      </header>

      <main className={`body ${selection ? "has-sheet" : ""}`}>
        {view === "map" ? (
          <CampusMap
            boundary={data.boundary}
            buildings={data.buildings}
            pins={pins}
            eventCounts={eventCounts}
            selection={selection}
            onSelect={setSelection}
          />
        ) : (
          <ListView
            events={events}
            pins={pins}
            community={community}
            now={now}
            nameOf={nameOf}
            onSelect={setSelection}
            suggest={SUGGEST_FORM}
          />
        )}
        {selection && (
          <Sheet
            selection={selection}
            data={data}
            buildingsById={buildingsById}
            now={now}
            onSelect={setSelection}
            onClose={() => setSelection(null)}
            onShowOnMap={view === "list" && selection.kind !== "community" ? () => setView("map") : undefined}
          />
        )}
      </main>
    </div>
  );
}

function OpenBadge({ r, now }: { r: { hours?: Pin["hours"] }; now: Date | null }) {
  if (!now || !r.hours) return null;
  const until = openUntil(r.hours, now);
  return until ? <span className="badge open">Open until {formatClock(until)}</span> : <span className="badge closed">Closed now</span>;
}

function Categories({ list }: { list?: string[] }) {
  return (
    <span className="cats">
      {list?.map((c) => (
        <span key={c} className="cat">
          <span className="dot" style={{ background: colorFor([c]) }} aria-hidden />
          {c}
        </span>
      ))}
    </span>
  );
}

interface ListProps {
  events: CampusEvent[];
  pins: Pin[];
  community: Community[];
  now: Date | null;
  nameOf: (loc?: string) => string | undefined;
  onSelect: (s: Selection) => void;
  suggest: string;
}

function ListView({ events, pins, community, now, nameOf, onSelect, suggest }: ListProps) {
  return (
    <div className="list">
      <section>
        <h2>Events</h2>
        {events.length === 0 && <p className="empty">No upcoming events match.</p>}
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <button className="item" onClick={() => onSelect({ kind: "building", id: e.location_id })}>
                <strong>{e.title}</strong>
                <span>{formatEventTime(e)}</span>
                <span className="muted">{[nameOf(e.location_id), e.room && `room ${e.room}`].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>On campus</h2>
        {pins.length === 0 && <p className="empty">No campus places match.</p>}
        <ul>
          {pins.map((p) => (
            <li key={p.id}>
              <button className="item" onClick={() => onSelect({ kind: "pin", id: p.id })}>
                <strong>{p.name}</strong>
                <span className="muted">{[nameOf(p.location_id), p.room && `room ${p.room}`].filter(Boolean).join(", ")}</span>
                <span className="row"><Categories list={p.category} /><OpenBadge r={p} now={now} /></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Off campus</h2>
        {community.length === 0 && <p className="empty">No community resources listed yet.</p>}
        <ul>
          {community.map((c) => (
            <li key={c.id}>
              <button className="item" onClick={() => onSelect({ kind: "community", id: c.id })}>
                <strong>{c.name}</strong>
                {c.address && <span className="muted">{c.address}</span>}
                <span className="row"><Categories list={c.category} /><OpenBadge r={c} now={now} /></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {suggest && (
        <p className="suggest">
          Missing something? <a href={suggest.replace("{id}", "")} target="_blank" rel="noopener">Suggest a place</a>
        </p>
      )}
    </div>
  );
}

interface SheetProps {
  selection: Selection;
  data: MapData;
  buildingsById: Map<string, Building>;
  now: Date | null;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  onShowOnMap?: () => void;
}

function Sheet({ selection, data, buildingsById, now, onSelect, onClose, onShowOnMap }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = () => navigator.clipboard?.writeText(window.location.href);
  const report = (id: string) => REPORT_FORM && (
    <a className="btn" href={REPORT_FORM.replace("{id}", encodeURIComponent(id))} target="_blank" rel="noopener">Report outdated info</a>
  );
  let body: React.ReactNode = <p>Not found.</p>;

  if (selection.kind === "building") {
    const b = buildingsById.get(selection.id);
    if (b) {
      const [lng, lat] = centroid(b);
      const evs = data.events.filter((e) => e.location_id === selection.id && (!now || isUpcoming(e, now)));
      const inside = data.pins.filter((p) => p.location_id === selection.id);
      body = (
        <>
          <h2>{b.properties.name}</h2>
          <div className="actions">
            <a className="btn primary" href={directionsUrl(lat, lng)} target="_blank" rel="noopener">Directions</a>
            <button className="btn" onClick={share}>Copy link</button>
            {report(selection.id)}
          </div>
          <h3>Events</h3>
          {evs.length === 0 ? <p className="empty">No upcoming events here.</p> : (
            <ul className="plain">
              {evs.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <div>{formatEventTime(e)}{e.room && ` · Room ${e.room}`}</div>
                  {e.description && <p>{e.description}</p>}
                  {e.url && <a href={e.url} target="_blank" rel="noopener">Details</a>}
                </li>
              ))}
            </ul>
          )}
          {inside.length > 0 && (
            <>
              <h3>In this building</h3>
              <ul className="plain">
                {inside.map((p) => (
                  <li key={p.id}>
                    <button className="link" onClick={() => onSelect({ kind: "pin", id: p.id })}>{p.name}</button>
                    {p.room && <span className="muted"> · {p.room}</span>} <OpenBadge r={p} now={now} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      );
    }
  } else {
    const r: (Pin | Community) | undefined =
      selection.kind === "pin" ? data.pins.find((p) => p.id === selection.id) : data.community.find((c) => c.id === selection.id);
    if (r) {
      const pin = selection.kind === "pin" ? (r as Pin) : null;
      const building = pin?.location_id ? buildingsById.get(pin.location_id) : undefined;
      const hasPoint = r.lat != null && r.lng != null;
      body = (
        <>
          <h2>{r.name}</h2>
          <div className="row"><Categories list={r.category} /><OpenBadge r={r} now={now} /></div>
          {building && (
            <p>
              <button className="link" onClick={() => onSelect({ kind: "building", id: building.properties.location_id })}>
                {building.properties.name}
              </button>
              {pin?.room && `, room ${pin.room}`}
            </p>
          )}
          {"address" in r && r.address && <p>{r.address}</p>}
          <div className="actions">
            {hasPoint && (
              <a className="btn primary" href={directionsUrl(r.lat!, r.lng!)} target="_blank" rel="noopener">
                {pin?.approximate ? "Directions to building" : "Directions"}
              </a>
            )}
            <button className="btn" onClick={share}>Copy link</button>
            {report(r.id)}
          </div>
          {r.description && <p>{r.description}</p>}
          {(r.hours || r.hours_note) && (
            <>
              <h3>Hours</h3>
              {r.hours && <ul className="plain">{hoursSummary(r.hours).map((h) => <li key={h}>{h}</li>)}</ul>}
              {r.hours_note && <p>{r.hours_note}</p>}
            </>
          )}
          {r.eligibility && <><h3>Who can use it</h3><p>{r.eligibility}</p></>}
          {pin?.accessibility && <><h3>Access</h3><p>{pin.accessibility}</p></>}
          {(r.phone || r.email || r.url) && (
            <>
              <h3>Contact</h3>
              <ul className="plain">
                {r.phone && <li><a href={`tel:${r.phone}`}>{r.phone}</a></li>}
                {r.email && <li><a href={`mailto:${r.email}`}>{r.email}</a></li>}
                {r.url && <li><a href={r.url} target="_blank" rel="noopener">Website</a></li>}
              </ul>
            </>
          )}
          {r.source_url && <p className="muted small">Source: <a href={r.source_url} target="_blank" rel="noopener">official page</a>{r.owner && ` · maintained by ${r.owner}`}</p>}
        </>
      );
    }
  }

  return (
    <aside className="sheet" aria-label="Details">
      <div className="sheet-head">
        {onShowOnMap && <button className="btn" onClick={onShowOnMap}>Show on map</button>}
        <button className="close" onClick={onClose} aria-label="Close details">×</button>
      </div>
      {body}
    </aside>
  );
}
