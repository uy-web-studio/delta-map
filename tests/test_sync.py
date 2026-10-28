import unittest
from datetime import datetime, timezone

from scripts.sync import build, parse_hours

BOUNDARY = {
    "type": "Feature",
    "properties": {},
    "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]},
}
BUILDINGS = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"location_id": "shima", "name": "Shima Center"},
            "geometry": {"type": "Polygon", "coordinates": [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]},
        }
    ],
}
NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)


def event(**kw):
    row = {"id": "e1", "title": "Club tabling", "location_id": "shima", "start": "2026-11-05 10:00",
           "end": "2026-11-05 12:00", "category": "Events", "status": "Approved"}
    row.update(kw)
    return row


def pin(**kw):
    row = {"id": "p1", "name": "Food Pantry", "kind": "service", "category": "Food", "location_id": "shima",
           "lat": "", "lng": "", "status": "Approved"}
    row.update(kw)
    return row


def run(events=(), pins=(), community=()):
    tabs = {"Events": list(events), "Pins": list(pins), "Community": list(community)}
    return build(tabs, BUILDINGS, BOUNDARY, now=NOW)


class ParseHoursTest(unittest.TestCase):
    def test_ranges_and_multiple_days(self):
        self.assertEqual(
            parse_hours("Mon-Wed 08:00-17:00; Fri 13:00-16:00"),
            {"mon": [["08:00", "17:00"]], "tue": [["08:00", "17:00"]], "wed": [["08:00", "17:00"]],
             "fri": [["13:00", "16:00"]]},
        )

    def test_blank_is_none(self):
        self.assertIsNone(parse_hours(""))

    def test_bad_value_raises(self):
        with self.assertRaises(ValueError):
            parse_hours("weekdays 9 to 5")


class BuildTest(unittest.TestCase):
    def test_only_approved_rows_publish(self):
        out, rejects = run(events=[event(), event(id="e2", status="Pending")])
        self.assertEqual([e["id"] for e in out["events"]], ["e1"])
        self.assertEqual(rejects, [])

    def test_event_converts_pacific_time_to_iso(self):
        out, _ = run(events=[event()])
        self.assertEqual(out["events"][0]["start"], "2026-11-05T10:00:00-08:00")

    def test_event_with_unknown_location_is_rejected(self):
        out, rejects = run(events=[event(location_id="nowhere")])
        self.assertEqual(out["events"], [])
        self.assertIn("nowhere", rejects[0]["reason"])

    def test_past_event_is_dropped_silently(self):
        out, rejects = run(events=[event(start="2026-10-01 10:00", end="2026-10-01 11:00")])
        self.assertEqual(out["events"], [])
        self.assertEqual(rejects, [])

    def test_unlisted_columns_never_publish(self):
        out, _ = run(events=[event(submitter_email="someone@example.com")])
        self.assertNotIn("submitter_email", out["events"][0])

    def test_pin_outside_campus_is_rejected(self):
        out, rejects = run(pins=[pin(lat="20", lng="20", location_id="")])
        self.assertEqual(out["pins"], [])
        self.assertIn("outside", rejects[0]["reason"])

    def test_pin_without_coordinates_takes_building_centroid(self):
        out, _ = run(pins=[pin()])
        p = out["pins"][0]
        self.assertEqual((p["lng"], p["lat"]), (2.0, 2.0))
        self.assertTrue(p["approximate"])

    def test_pin_needs_coordinates_or_building(self):
        _, rejects = run(pins=[pin(location_id="")])
        self.assertIn("coordinates or a location_id", rejects[0]["reason"])

    def test_bad_hours_reject_only_that_row(self):
        out, rejects = run(pins=[pin(hours="sometimes"), pin(id="p2", hours="Mon 09:00-10:00")])
        self.assertEqual([p["id"] for p in out["pins"]], ["p2"])
        self.assertEqual(rejects[0]["id"], "p1")

    def test_community_resources_skip_bounds_check(self):
        row = {"id": "c1", "name": "Food bank", "category": "Food", "lat": "40", "lng": "40", "status": "Approved"}
        out, rejects = run(community=[row])
        self.assertEqual(out["community"][0]["id"], "c1")
        self.assertEqual(rejects, [])


if __name__ == "__main__":
    unittest.main()
