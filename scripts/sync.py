"""Sync approved rows from the Google Sheet (or CSV exports of it) into data/*.json.

The sync is one way: Sheet -> repo. Only Approved rows and whitelisted columns publish, so
anything else in the Sheet (submitter emails, moderator notes) never reaches the public repo.

    python -m scripts.sync --csv-dir data/seed      # local / Colab, no credentials
    python -m scripts.sync --sheet $SHEET_ID        # needs GOOGLE_SERVICE_ACCOUNT_JSON
    python -m scripts.sync --check                  # validate committed data only
"""

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.geo import centroid, point_in_geometry

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PACIFIC = ZoneInfo("America/Los_Angeles")
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TABS = ("Events", "Pins", "Community")

# Columns allowed to publish, per Sheet tab. Anything not listed stays in Drive.
COLUMNS = {
    "Events": ["id", "title", "location_id", "room", "start", "end", "category", "description", "url",
               "languages", "source_url", "owner"],
    "Pins": ["id", "name", "kind", "category", "location_id", "room", "lat", "lng", "description", "hours",
             "hours_note", "eligibility", "phone", "email", "url", "languages", "accessibility", "source_url", "owner",
             "last_verified", "next_review"],
    "Community": ["id", "name", "category", "address", "lat", "lng", "description", "hours", "eligibility",
                  "phone", "email", "url", "languages", "source_url", "owner", "last_verified", "next_review"],
}
LIST_FIELDS = {"category", "languages"}
HOURS_RE = re.compile(r"^(\w{3})(?:-(\w{3}))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$")


class RowError(ValueError):
    pass


def parse_hours(text):
    """'Mon-Fri 08:00-17:00; Sat 10:00-12:00' -> {'mon': [['08:00', '17:00']], ...}."""
    text = (text or "").strip()
    if not text:
        return None
    hours = {}
    for part in filter(None, (p.strip() for p in text.split(";"))):
        m = HOURS_RE.match(part)
        if not m or m[1].lower() not in DAYS or (m[2] and m[2].lower() not in DAYS):
            raise ValueError(f"can't read hours {part!r}; use e.g. 'Mon-Fri 08:00-17:00; Sat 10:00-12:00'")
        first = DAYS.index(m[1].lower())
        last = DAYS.index(m[2].lower()) if m[2] else first
        for day in DAYS[first:last + 1]:
            hours.setdefault(day, []).append([m[3], m[4]])
    return {d: hours[d] for d in DAYS if d in hours}


def _local_time(text, field):
    try:
        return datetime.strptime(text.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=PACIFIC)
    except ValueError:
        raise RowError(f"{field} {text!r} should look like 2026-11-05 14:30 (Pacific time)")


def _coords(row):
    lat, lng = (row.get("lat") or "").strip(), (row.get("lng") or "").strip()
    if not lat and not lng:
        return None
    try:
        return float(lng), float(lat)
    except ValueError:
        raise RowError(f"lat/lng {lat!r}, {lng!r} are not numbers")


def _clean(tab, row):
    out = {}
    for col in COLUMNS[tab]:
        value = (row.get(col) or "").strip()
        if not value:
            continue
        out[col] = [v.strip() for v in value.split(",") if v.strip()] if col in LIST_FIELDS else value
    if not out.get("id"):
        raise RowError("missing id")
    return out


def _event(row, buildings, now):
    loc = row.get("location_id")
    if loc not in buildings:
        raise RowError(f"location_id {loc!r} matches no building")
    start, end = _local_time(row.get("start", ""), "start"), _local_time(row.get("end", ""), "end")
    if end < start:
        raise RowError("end is before start")
    if end < now:
        return None  # finished; drops off quietly
    row["start"], row["end"] = start.isoformat(), end.isoformat()
    return row


def _pin(row, buildings, boundary):
    xy = _coords(row)
    loc = row.get("location_id")
    if loc and loc not in buildings:
        raise RowError(f"location_id {loc!r} matches no building")
    if xy:
        if not point_in_geometry(*xy, boundary["geometry"]):
            raise RowError(f"point {xy} is outside the campus boundary")
        row["approximate"] = False
    elif loc:
        xy = centroid(buildings[loc]["geometry"])
        row["approximate"] = True
    else:
        raise RowError("needs coordinates or a location_id")
    row["lng"], row["lat"] = xy
    return row


def _resource_fields(row):
    if "hours" in row:
        try:
            row["hours"] = parse_hours(row["hours"])
        except ValueError as e:
            raise RowError(str(e))
    return row


def build(tabs, buildings_fc, boundary, now=None):
    """Turn Sheet rows into publishable records. Returns ({'events', 'pins', 'community'}, rejects)."""
    now = now or datetime.now(timezone.utc)
    buildings = {f["properties"]["location_id"]: f for f in buildings_fc["features"]}
    out = {"events": [], "pins": [], "community": []}
    rejects = []
    for tab in TABS:
        for n, raw in enumerate(tabs.get(tab, []), start=2):  # row 1 is the header
            if (raw.get("status") or "").strip().lower() != "approved":
                continue
            try:
                row = _clean(tab, raw)
                if tab == "Events":
                    row = _event(row, buildings, now)
                elif tab == "Pins":
                    row = _pin(_resource_fields(row), buildings, boundary)
                else:
                    row = _resource_fields(row)
                    if xy := _coords(row):
                        row["lng"], row["lat"] = xy
                if row:
                    out[tab.lower()].append(row)
            except RowError as e:
                rejects.append({"tab": tab, "row": n, "id": raw.get("id", ""), "reason": str(e)})
    out["events"].sort(key=lambda e: e["start"])
    out["pins"].sort(key=lambda p: p["name"].lower())
    out["community"].sort(key=lambda c: c["name"].lower())
    return out, rejects


def overdue_reviews(records, today=None):
    today = today or date.today().isoformat()
    return [r for r in records if r.get("next_review") and r["next_review"] < today]


def read_csv_dir(path):
    tabs = {}
    for tab in TABS:
        f = Path(path) / f"{tab.lower()}.csv"
        tabs[tab] = list(csv.DictReader(f.open(newline="", encoding="utf-8"))) if f.exists() else []
    return tabs


def read_sheet(sheet_id):
    from google.oauth2 import service_account  # only needed for the live Sheet
    from google.auth.transport.requests import Request

    info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    creds.refresh(Request())
    tabs = {}
    for tab in TABS:
        url = (f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/"
               f"{urllib.parse.quote(tab)}?valueRenderOption=FORMATTED_VALUE")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {creds.token}"})
        values = json.load(urllib.request.urlopen(req)).get("values", [])
        header = [h.strip() for h in values[0]] if values else []
        tabs[tab] = [dict(zip(header, r)) for r in values[1:]]
    return tabs


def load_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def write_json(name, value):
    text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    path = DATA / name
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv-dir", help="folder with events.csv, pins.csv, community.csv")
    src.add_argument("--sheet", help="Google Sheet id")
    src.add_argument("--check", action="store_true", help="validate committed data/*.json")
    args = ap.parse_args(argv)

    buildings, boundary = load_json("buildings.geojson"), load_json("boundary.geojson")

    if args.check:
        published = {"events": load_json("events.json"), "pins": load_json("pins.json")}
        known = {f["properties"]["location_id"] for f in buildings["features"]}
        bad = [e["id"] for e in published["events"] if e["location_id"] not in known]
        bad += [p["id"] for p in published["pins"]
                if not point_in_geometry(p["lng"], p["lat"], boundary["geometry"])]
        print(f"checked {len(published['events'])} events, {len(published['pins'])} pins; {len(bad)} problems")
        for b in bad:
            print(f"  problem: {b}")
        return 1 if bad else 0

    tabs = read_csv_dir(args.csv_dir) if args.csv_dir else read_sheet(args.sheet)
    out, rejects = build(tabs, buildings, boundary)
    changed = [name for name, key in (("events.json", "events"), ("pins.json", "pins"),
                                      ("community.json", "community")) if write_json(name, out[key])]

    print(f"published {len(out['events'])} events, {len(out['pins'])} pins, {len(out['community'])} community")
    print(f"changed: {', '.join(changed) or 'nothing'}")
    for r in rejects:
        print(f"  rejected {r['tab']} row {r['row']} ({r['id'] or 'no id'}): {r['reason']}")
    for r in overdue_reviews(out["pins"] + out["community"]):
        print(f"  review overdue: {r['name']} (owner {r.get('owner', 'unknown')}, due {r['next_review']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
