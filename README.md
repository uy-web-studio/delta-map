# Delta Community Map

A mobile-first map of San Joaquin Delta College: building outlines that events attach to, and pins for
the offices, services and entrances people navigate to. It is a static site on GitHub Pages; the
"backend" is a Google Sheet, a sync script and this repo.

Spec: [Delta Community Map — Product Spec](https://claude.ai/artifact/Mif3xEZDjrQfBAW6jMuoQv)

## How data flows

```
Google Forms ─▶ Google Sheet ──(scripts/sync.py, nightly Action)──▶ data/*.json ──▶ GitHub Pages
                 (moderators set Status = Approved)                        ▲
OpenStreetMap ──(scripts/import_osm.py, Colab notebook, via PR)──▶ data/buildings.geojson
```

- The sync is one way, Sheet → repo. The Sheet owns events, pins and community resources; the repo
  owns building geometry and everything published.
- Only rows with `Status = Approved` and only whitelisted columns publish (see `COLUMNS` in
  `scripts/sync.py`), so submitter emails and notes never reach this public repo.
- Events have no coordinates. They point at a building by `location_id`; the sync rejects any event
  whose `location_id` matches no building, and any pin outside the campus boundary.
- A pin without its own `lat`/`lng` is placed at its building's centroid and offers
  "Directions to building".

## Data files

| File | Written by | What |
| --- | --- | --- |
| `data/boundary.geojson` | `import_osm.py` | Campus outline; the map can't pan past it |
| `data/buildings.geojson` | `import_osm.py`, Colab | Building polygons keyed by `location_id` |
| `data/pins.json` | `sync.py` | Campus places, with coordinates |
| `data/events.json` | `sync.py` | Upcoming events (finished ones drop at each sync) |
| `data/community.json` | `sync.py` | Off-campus resources (list view only) |
| `data/seed/*.csv` | by hand, `crawl_delta.py` | Starting rows; import them into the Sheet's tabs |

## Google Sheet setup

1. Create a Sheet with tabs **Events**, **Pins** and **Community**. Use the header rows from
   `data/seed/*.csv` (import those files to start). Add any private columns you like
   (e.g., `submitter_email`, `notes`); they never publish.
2. Times are Pacific, written `2026-11-05 14:30`. Hours are written `Mon-Fri 08:00-17:00; Sat 10:00-12:00`.
   Categories and languages are comma-separated.
3. Create a Google Cloud service account, enable the Sheets API, and share the Sheet with the
   service account's email as **Viewer**.
4. Optional: link Google Forms to the Sheet for "Suggest a place", "Report outdated info" and
   organizer event entry. For events, make the building a dropdown of `location_id`s.

## GitHub setup

1. Push this repo, then in **Settings → Pages** set the source to **GitHub Actions**.
2. **Settings → Secrets and variables → Actions**:
   - secret `GOOGLE_SERVICE_ACCOUNT_JSON`: the service account key (the whole JSON)
   - variable `SHEET_ID`: the id from the Sheet's URL
   - variables `REPORT_FORM_URL`, `SUGGEST_FORM_URL` (optional): form links; `{id}` in them is
     replaced with the pin or building id, so use a prefilled-link URL with `{id}` as the value
3. `Deploy to GitHub Pages` runs on every push to `main`. `Sync from Google Sheet` runs nightly and
   on demand, commits any data changes, and redeploys.

## Local development

```sh
npm install
npm run dev                 # http://localhost:3000
npm test                    # Python tests for the sync and geometry
npm run sync                # rebuild data/*.json from data/seed/*.csv
python3 -m scripts.sync --check
python3 -m scripts.import_osm   # refresh buildings from OpenStreetMap
python3 -m scripts.crawl_delta --cache /tmp/delta-pages  # refresh offices from deltacollege.edu
```

The base map is OpenStreetMap data via [OpenFreeMap](https://openfreemap.org) tiles (no key, no
cookies), set in `lib/categories.ts`.

## Offices from deltacollege.edu

`scripts/crawl_delta.py` reads the site's sitemap, fetches every `/about/offices/<slug>` page
(1 request/s, cached), and turns each office's "Contact and Hours" box into a pin row: building and
room (mapped to a `location_id`), phone, email, hours, the first paragraph of "About the Office",
and exact coordinates where the page's campus-map link has them. It merges into
`data/seed/pins.csv` by id and keeps hand-written rows. Hours that aren't a plain weekly schedule
(semester-specific, lunch closures) go in `hours_note` as Delta wrote them. Offices in buildings
with no outline yet (Goleman Library, the Data Center) and off-campus sites are skipped and listed.

## Colab

`notebooks/geometry.ipynb` refreshes footprints from OSM, shows them on a map, renames
`location_id`s, runs the sync, and pushes a branch for a pull request. Open it from Drive or from
GitHub in Colab.
