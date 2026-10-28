"""Import the campus boundary and building footprints from OpenStreetMap.

    python -m scripts.import_osm                    # query Overpass live
    python -m scripts.import_osm --from-file x.json # reuse a saved Overpass response

A building keeps its location_id across re-imports (matched by OSM id), because events point
at it. New buildings get an id slugged from their name; rename one by editing
data/buildings.geojson once, and later imports keep your edit.
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

from scripts.geo import centroid, point_in_geometry
from scripts.sync import DATA, write_json

CAMPUS_WAY = 321234060  # "San Joaquin Delta College" campus outline in OSM
OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = f"""[out:json][timeout:90];
way({CAMPUS_WAY});out geom;
map_to_area->.c;
(way["building"](area.c);relation["building"](area.c););
out geom;"""
DROP_WORDS = {"building", "center", "hall", "the", "for", "and", "of"}


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": "delta-map (campus map importer)"})
    return json.load(urllib.request.urlopen(req, timeout=120))


def slug(name):
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in DROP_WORDS]
    return "-".join(words) or "building"


def _ring(points):
    ring = [[round(p["lon"], 7), round(p["lat"], 7)] for p in points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _stitch(segments):
    """Join a relation's outer way pieces into closed rings."""
    segments = [s[:] for s in segments]
    rings = []
    while segments:
        ring = segments.pop(0)
        while ring[0] != ring[-1]:
            for i, s in enumerate(segments):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                else:
                    continue
                segments.pop(i)
                break
            else:
                break  # can't close it; leave as is
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def geometry_of(element):
    if element["type"] == "way":
        return {"type": "Polygon", "coordinates": [_ring(element["geometry"])]}
    outers = [[[round(p["lon"], 7), round(p["lat"], 7)] for p in m["geometry"]]
              for m in element.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    inners = [[[round(p["lon"], 7), round(p["lat"], 7)] for p in m["geometry"]]
              for m in element.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
    rings, holes = _stitch(outers), _stitch(inners)
    if not rings:
        return None
    polys = [[r] + [h for h in holes if point_in_geometry(*h[0], {"type": "Polygon", "coordinates": [r]})]
             for r in rings]
    return {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}


def convert(overpass, existing=None):
    campus = next(e for e in overpass["elements"] if e["type"] == "way" and e["id"] == CAMPUS_WAY)
    boundary = {"type": "Feature", "properties": {"name": campus["tags"].get("name"), "osm": f"way/{CAMPUS_WAY}"},
                "geometry": {"type": "Polygon", "coordinates": [_ring(campus["geometry"])]}}

    kept = {f["properties"]["osm"]: f["properties"] for f in (existing or {}).get("features", [])
            if f["properties"].get("osm")}
    used = {p["location_id"] for p in kept.values()}
    features, skipped = [], []
    for e in overpass["elements"]:
        if "building" not in e.get("tags", {}) or e["id"] == CAMPUS_WAY:
            continue
        osm = f"{e['type']}/{e['id']}"
        geom = geometry_of(e)
        if not geom or not point_in_geometry(*centroid(geom), boundary["geometry"]):
            skipped.append(e["tags"].get("name") or osm)
            continue
        name = e["tags"].get("name")
        if osm in kept:
            props = kept[osm]
        else:
            loc = slug(name) if name else f"bldg-{e['id']}"
            while loc in used:
                loc += "-2"
            used.add(loc)
            props = {"location_id": loc, "name": name or "Unnamed building", "osm": osm}
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    features.sort(key=lambda f: (f["properties"]["name"] == "Unnamed building", f["properties"]["name"]))
    return boundary, {"type": "FeatureCollection", "features": features}, skipped


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-file", help="saved Overpass JSON response")
    args = ap.parse_args(argv)
    overpass = json.load(open(args.from_file)) if args.from_file else fetch()
    path = DATA / "buildings.geojson"
    existing = json.loads(path.read_text()) if path.exists() else None
    boundary, buildings, skipped = convert(overpass, existing)
    write_json("boundary.geojson", boundary)
    write_json("buildings.geojson", buildings)
    named = sum(f["properties"]["name"] != "Unnamed building" for f in buildings["features"])
    print(f"{len(buildings['features'])} buildings ({named} named); skipped outside campus: {', '.join(skipped) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
