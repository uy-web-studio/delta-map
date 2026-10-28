"""Small GeoJSON helpers, stdlib only so the sync runs anywhere (Actions, Colab, a laptop)."""


def _polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"unsupported geometry type {geometry['type']}")


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(x, y, geometry):
    """True when (x, y) = (lng, lat) falls inside a Polygon or MultiPolygon, holes excluded."""
    for outer, *holes in _polygons(geometry):
        if _in_ring(x, y, outer) and not any(_in_ring(x, y, h) for h in holes):
            return True
    return False


def _ring_area_centroid(ring):
    area = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area /= 2
    if area == 0:
        return 0.0, ring[0][0], ring[0][1]
    return abs(area), cx / (6 * area), cy / (6 * area)


def centroid(geometry):
    """Centroid (lng, lat) of the largest outer ring; good enough for a label or a directions target."""
    best = max((_ring_area_centroid([p[:2] for p in poly[0]]) for poly in _polygons(geometry)), key=lambda t: t[0])
    return round(best[1], 7), round(best[2], 7)
