import unittest

from scripts.crawl_delta import location_of, parse_office, structured_hours


class StructuredHoursTest(unittest.TestCase):
    def test_simple_weekday_range(self):
        self.assertEqual(structured_hours("Monday - Friday: 8:00 a.m. - 5:00 p.m."), "Mon-Fri 08:00-17:00")

    def test_two_segments_and_bare_hour(self):
        self.assertEqual(
            structured_hours("Monday - Thursday: 7:45 a.m. - 5 p.m. Friday: 7:45 a.m. - 12:00 p.m."),
            "Mon-Thu 07:45-17:00; Fri 07:45-12:00",
        )

    def test_listed_days(self):
        self.assertEqual(
            structured_hours("Monday, Tuesday and Friday: 8:00 a.m. – 5:00 p.m."),
            "Mon 08:00-17:00; Tue 08:00-17:00; Fri 08:00-17:00",
        )

    def test_plural_days_and_several_spans_a_day(self):
        self.assertEqual(
            structured_hours("Wednesdays : 8:00 a.m. - 2:30 p.m. Thursday: 8:00 a.m. - 9:00 a.m., 10:00 a.m. - 3:00 p.m."),
            "Wed 08:00-14:30; Thu 08:00-09:00; Thu 10:00-15:00",
        )

    def test_always_open(self):
        self.assertEqual(structured_hours("24 hours / 7 days a week"), "Mon-Sun 00:00-24:00")

    def test_anything_else_is_not_structured(self):
        self.assertIsNone(structured_hours("Fall & Spring Semester Hours Monday - Friday: 8:00 a.m. - 5:00 p.m."))
        self.assertIsNone(structured_hours("Monday - Friday: 8:00 a.m. - 5:00 p.m. (closed daily 12-1)"))


class LocationTest(unittest.TestCase):
    def test_building_and_room(self):
        self.assertEqual(location_of("DeRicco Building, Room 110 (DERIC 110)"), ("dericco", "110"))
        self.assertEqual(location_of("Danner Hall, Room, Room B6 (B6)"), ("danner", "B6"))
        self.assertEqual(location_of("Science and Math Building, Rooms 243 (SCMA 243)"), ("science-math", "243"))

    def test_unknown_building(self):
        self.assertEqual(location_of("Goleman Learning Resource Center Building"), (None, None))


PAGE = """<html><head><title>Disability Support Programs and Services | San Joaquin Delta College</title></head><body>
<h1 class="x">Disability Support Programs and Services</h1>
<div class="contact-accordion-phone mb-4"><a href="tel:+1-209-954-5151,6272">(209) 954-5151 ext. 6272</a>
<a href="mailto:dsps@deltacollege.edu">dsps@deltacollege.edu</a></div>
<address class="contact-accordion-address mb-4"> <div>San Joaquin Delta College<br /> Disability Support Programs &amp; Services (DSPS)<br />
DeRicco Building, Room 110 (DERIC 110)<br /> 5151 Pacific Avenue, Stockton, CA 95207<br /> </div></address>
<div class="contact-accordion-hours"> <div><p><strong>Monday - Friday:</strong> 8:00 a.m. - 5:00 p.m.</p></div> </div>
<a href="https://maps.deltacollege.edu/?id=2147#!m/1?mc/37.99756599999999,-121.31683299999997?z/21">Campus Map</a>
<p class="fs-3 font-bowlby-one"> About the Office </p><div><p>DSPS provides academic accommodations to students with verified disabilities.</p></div>
</body></html>"""


class ParseOfficeTest(unittest.TestCase):
    def test_full_page(self):
        row = parse_office("dsps", "https://www.deltacollege.edu/about/offices/dsps", PAGE)
        self.assertEqual(row["name"], "Disability Support Programs and Services")
        self.assertEqual((row["location_id"], row["room"]), ("dericco", "110"))
        self.assertEqual((row["lat"], row["lng"]), ("37.997566", "-121.316833"))
        self.assertEqual(row["hours"], "Mon-Fri 08:00-17:00")
        self.assertEqual(row["phone"], "(209) 954-5151 ext. 6272")
        self.assertEqual(row["email"], "dsps@deltacollege.edu")
        self.assertTrue(row["description"].startswith("DSPS provides"))

    def test_page_without_address_is_skipped(self):
        self.assertIsNone(parse_office("x", "https://example.com", "<h1>Division</h1>"))


if __name__ == "__main__":
    unittest.main()
