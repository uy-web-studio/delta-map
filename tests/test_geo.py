import unittest

from scripts.geo import centroid, point_in_geometry

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}
DONUT = {
    "type": "Polygon",
    "coordinates": [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
}


class PointInGeometryTest(unittest.TestCase):
    def test_inside_and_outside(self):
        self.assertTrue(point_in_geometry(5, 5, SQUARE))
        self.assertFalse(point_in_geometry(15, 5, SQUARE))

    def test_hole_is_outside(self):
        self.assertFalse(point_in_geometry(5, 5, DONUT))
        self.assertTrue(point_in_geometry(2, 2, DONUT))

    def test_multipolygon(self):
        multi = {"type": "MultiPolygon", "coordinates": [SQUARE["coordinates"], [[[20, 20], [30, 20], [30, 30], [20, 20]]]]}
        self.assertTrue(point_in_geometry(25, 22, multi))
        self.assertFalse(point_in_geometry(15, 15, multi))


class CentroidTest(unittest.TestCase):
    def test_square_centroid(self):
        self.assertEqual(centroid(SQUARE), (5.0, 5.0))


if __name__ == "__main__":
    unittest.main()
