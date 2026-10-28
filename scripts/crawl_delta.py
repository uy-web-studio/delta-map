"""Crawl deltacollege.edu office pages into pin rows for the seed CSV / Google Sheet.

    python -m scripts.crawl_delta --cache /tmp/delta-pages

Reads the site's sitemap, fetches each /about/offices/<slug> page (one request per second,
cached), and pulls the name, building + room, hours, phone, email, campus-map coordinates and
the first paragraph of "About the Office". Rows are merged into data/seed/pins.csv by id:
crawled rows are replaced, hand-written rows are kept. Import the result into the Sheet's
Pins tab; the Sheet stays the source of truth after that.
"""

import argparse
import csv
import html
import re
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from scripts.sync import COLUMNS, DATA

SITE = "https://www.deltacollege.edu"
USER_AGENT = "delta-map (student resource map; crawls office pages once, 1 req/s)"
SEED = DATA / "seed" / "pins.csv"
FIELDS = COLUMNS["Pins"] + ["status"]

# Building words as Delta writes them -> location_id in data/buildings.geojson.
# Goleman Library and the Data Center have no outline in OpenStreetMap yet.
BUILDINGS = [
    (r"dericco", "dericco"),
    (r"shima", "shima"),
    (r"holt", "holt"),
    (r"budd (center )?building|budd building", "budd"),
    (r"danner", "danner"),
    (r"locke", "locke"),
    (r"horton administration|^administration building", "horton-administration"),
    (r"forum", "forum"),
    (r"science and math", "science-math"),
    (r"child development", "child-development"),
    (r"lourn phelps", "lourn-phelps-police-services"),
]

CATEGORIES = {
    "basic-needs-center": "Food, Housing",
    "food-services-office": "Food",
    "health-wellness-office": "Health & wellness",
    "dsps": "Disability & access",
    "child-development-center": "Family & childcare",
    "veteran-resource-center": "Veterans",
    "dreamers-success-center": "Legal & immigration",
    "financial-aid-scholarships-office": "Money & financial aid",
    "calworks-office": "Money & financial aid, Family & childcare",
    "calworks-assessment-office": "Money & financial aid, Family & childcare",
    "eops-care-nextup-center": "Money & financial aid, Academic support",
    "vault-services-office": "Money & financial aid",
    "counseling-retention-office": "Academic support",
    "delta-connect-center": "Academic support",
    "library": "Academic support",
    "mesa": "Academic support",
    "regional-distance-education-office": "Academic support",
    "information-technology-office": "Tech access",
    "police-department": "Safety",
    "asdc": "Events, Student life",
    "student-life-office": "Events, Student life",
    "delta-center-arts": "Events",
    "lh-horton-jr-art-gallery": "Events",
    "athletics-office": "Events",
    "pride-center": "Student life",
    "empowerment-resource-center": "Student life",
    "access-equity-deans-office": "Student life",
    "admission-records-office": "Campus services",
    "enrollment-services-dean-office": "Campus services",
    "outreach-relation-schools-office": "Campus services",
    "bookstore": "Campus services",
    "apprenticeship-office": "Career & jobs",
    "cte-and-workforce-development": "Career & jobs",
    "directing-adults-right-trac-employment-darte": "Career & jobs",
    "strong-workforce-program-office": "Career & jobs",
    "workforce-development-center": "Career & jobs",
    "workforce-training-institute-office": "Career & jobs",
    "worknet-office": "Career & jobs",
    "epicenter": "Career & jobs",
    "post-academy": "Career & jobs",
}

DAY_NAMES = {"monday": "Mon", "tuesday": "Tue", "wednesday": "Wed", "thursday": "Thu", "friday": "Fri",
             "saturday": "Sat", "sunday": "Sun"}
DAY = r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?"
TIME = r"(\d{1,2})(?::\s?(\d{2}))?\s*([ap])\.?\s?m\.?"
SPAN = rf"{TIME}\s*(?:-|–|to)\s*{TIME}"
SEGMENT = re.compile(
    rf"(?P<days>{DAY}(?:\s*(?:-|–|,|and|&)\s*{DAY})*)\s*[:,]?\s*(?P<spans>{SPAN}(?:\s*,\s*{SPAN})*)", re.I)


def text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _clock(h, m, ap):
    h = int(h) % 12 + (12 if ap.lower() == "p" else 0)
    return f"{h:02d}:{m or '00'}"


def structured_hours(raw):
    """Delta's hours text -> 'Mon-Fri 08:00-17:00; ...', or None when it isn't a plain weekly schedule."""
    raw = raw.strip()
    if re.fullmatch(r"24 hours\s*/\s*7 days a week", raw, re.I):
        return "Mon-Sun 00:00-24:00"
    parts, pos = [], 0
    for m in SEGMENT.finditer(raw):
        if raw[pos:m.start()].strip(" .;*"):
            return None  # words we don't understand before this segment
        days = [DAY_NAMES[d.lower().rstrip("s")] for d in re.findall(DAY, m["days"], re.I)]
        for t in re.finditer(SPAN, m["spans"], re.I):
            span = f"{_clock(*t.groups()[0:3])}-{_clock(*t.groups()[3:6])}"
            if re.search(r"-|–", m["days"]) and len(days) == 2:
                parts.append(f"{days[0]}-{days[1]} {span}")
            else:
                parts += [f"{d} {span}" for d in days]
        pos = m.end()
    if not parts or raw[pos:].strip(" .;*"):
        return None
    return "; ".join(parts)


def location_of(line):
    """'DeRicco Building, Room 110 (DERIC 110)' -> ('dericco', '110')."""
    low = line.lower()
    loc = next((lid for pattern, lid in BUILDINGS if re.search(pattern, low)), None)
    if not loc:
        return None, None
    room = re.search(r"rooms?\s*,?\s*(?:room\s*)?([a-z]?\d+[a-z]?)", line, re.I)
    return loc, room[1].upper() if room else None


def _about(page):
    i = page.find("About the Office")
    if i < 0:
        return ""
    p = re.search(r"<p[^>]*>(.*?)</p>", page[i:], re.S)
    words = text(p[1]) if p else ""
    if len(words) <= 400:
        return words
    cut = words[:400].rsplit(". ", 1)[0]
    return cut + "." if not cut.endswith(".") else cut


def parse_office(slug, url, page):
    addr = re.search(r'<address class="contact-accordion-address[^"]*"[^>]*>\s*<div>(.*?)</div>', page, re.S)
    if not addr:
        return None
    lines = [text(l).lstrip("/> ").strip() for l in re.split(r"<br\s*/?>", addr[1])]
    loc, room = None, None
    for line in lines:
        loc, room = location_of(line)
        if loc:
            break
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    hours_raw = re.search(r'<div class="contact-accordion-hours">(.*?)</div>\s*</div>', page, re.S)
    hours_raw = text(hours_raw[1]) if hours_raw else ""
    phone_block = re.search(r'<div class="contact-accordion-phone[^"]*">(.*?)</div>', page, re.S)
    phone = re.search(r'<a href="tel:[^"]*">(.*?)</a>', phone_block[1]) if phone_block else None
    email = re.search(r'href="mailto:([^"]+)"', phone_block[1]) if phone_block else None
    mc = re.search(r"mc/(-?\d+\.\d+),(-?\d+\.\d+)", page)
    hours = structured_hours(hours_raw) if hours_raw else None
    name = text(h1[1]) if h1 else slug
    return {
        "id": slug.lower(),
        "name": name,
        "kind": "office",
        "category": CATEGORIES.get(slug.lower(), "Campus offices"),
        "location_id": loc or "",
        "room": room or "",
        "lat": f"{float(mc[1]):.6f}" if mc else "",
        "lng": f"{float(mc[2]):.6f}" if mc else "",
        "description": _about(page),
        "hours": hours or "",
        "hours_note": "" if hours or not hours_raw else hours_raw[:300],
        "phone": text(phone[1]) if phone else "",
        "email": email[1] if email else "",
        "url": url,
        "languages": "English",
        "source_url": url,
        "owner": name,
        "last_verified": date.today().isoformat(),
        "next_review": (date.today() + timedelta(days=90)).isoformat(),
        "status": "Approved",
    }


def fetch(url, cache):
    path = Path(cache) / (re.sub(r"[^\w.-]+", "_", url.split("://", 1)[1]) + ".html")
    if path.exists():
        return path.read_text(encoding="utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    body = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    path.write_text(body, encoding="utf-8")
    time.sleep(1)
    return body


def office_urls(cache):
    index = fetch(f"{SITE}/sitemap.xml", cache)
    urls = []
    for sub in re.findall(r"<loc>([^<]+)</loc>", index):
        urls += re.findall(r"<loc>([^<]+)</loc>", fetch(html.unescape(sub), cache))
    return sorted({u for u in urls if re.fullmatch(rf"{SITE}/about/offices/[^/]+", u)})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True, help="folder for downloaded pages (reused on re-runs)")
    args = ap.parse_args(argv)
    Path(args.cache).mkdir(parents=True, exist_ok=True)

    crawled, skipped = {}, []
    for url in office_urls(args.cache):
        slug = url.rsplit("/", 1)[1]
        row = parse_office(slug, url, fetch(url, args.cache))
        if not row:
            skipped.append(f"{slug} (no address)")
        elif not row["location_id"] and not row["lat"]:
            skipped.append(f"{slug} (building not on the map)")
        else:
            crawled[row["id"]] = row

    existing = list(csv.DictReader(SEED.open(newline="", encoding="utf-8"))) if SEED.exists() else []
    kept = [r for r in existing if r["id"] not in crawled]
    rows = kept + sorted(crawled.values(), key=lambda r: r["name"].lower())
    with SEED.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(f"{len(crawled)} offices crawled, {len(kept)} hand-written rows kept -> {SEED.relative_to(DATA.parent)}")
    print(f"hours as free text (no weekly schedule): {sum(1 for r in crawled.values() if r['hours_note'])}")
    for s in skipped:
        print(f"  skipped {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
