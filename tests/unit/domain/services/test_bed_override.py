"""Unit tests for the manual bed-level override (owner ruling 2026-09-06).

The owner's rule, in his words:

    "inside a bed polygon the ground surface is the bed level; outside it is the
    DEM; the section DEM line shows the bed where it crosses the polygon."

Context: his site was dredged 8 m for a canal.  The DEM over the water carries
the WATER surface, not the dredged bed, so the model needs a way to say "the
ground here is really at -4 m TAW".  A polygon drawn on the map with one
constant bed elevation does that: inside the polygon the ground surface takes
the bed level; outside, it is the DEM as before.
"""

from __future__ import annotations

from groundmodel.domain.services.bed_override import (
    bed_level_at,
    ground_sampler_with_bed,
)
from groundmodel.domain.value_objects.bed_override_polygon import BedOverridePolygon

# A 30 m square canal-bed polygon dredged to -4 m TAW, centred on (50, 50).
# The ring spans 35..65 so the sample points at x = 40/50/60 are strictly
# inside and x = 30/70 strictly outside (never on an edge, where even-odd
# point-in-polygon is undefined).
_CANAL = BedOverridePolygon(
    label="Canal bed",
    level_m=-4.0,
    vertices=[(35.0, 35.0), (65.0, 35.0), (65.0, 65.0), (35.0, 65.0)],
)


def _flat_dem(z: float):
    """A DEM sampler at a constant elevation everywhere."""

    def sample(x: float, y: float) -> float | None:
        return z

    return sample


def test_inside_a_bed_polygon_the_ground_is_the_bed_level() -> None:
    """A point inside the polygon reads the polygon's bed level, not the DEM."""
    assert bed_level_at([_CANAL], 50.0, 50.0) == -4.0


def test_outside_a_bed_polygon_there_is_no_override() -> None:
    """A point outside every polygon has no override — the DEM stands."""
    assert bed_level_at([_CANAL], 5.0, 5.0) is None


def test_the_sampler_returns_the_bed_inside_and_the_dem_outside() -> None:
    """The wrapped sampler is the bed level inside the polygon, the DEM outside.

    This is the ground surface the section DEM line and the 3D terrain read:
    inside the canal it is the dredged bed (-4 m), outside it the DEM (+2 m).
    """
    sampler = ground_sampler_with_bed(_flat_dem(2.0), [_CANAL])
    assert sampler(50.0, 50.0) == -4.0  # inside the canal → the bed
    assert sampler(5.0, 5.0) == 2.0  # outside → the DEM


def test_the_bed_fills_in_where_the_dem_has_no_data() -> None:
    """Inside the polygon the bed applies even over a DEM hole (water NoData)."""
    sampler = ground_sampler_with_bed(_flat_dem(2.0), [_CANAL])

    def dem_hole(x: float, y: float) -> float | None:
        return None

    sampler_hole = ground_sampler_with_bed(dem_hole, [_CANAL])
    assert sampler_hole(50.0, 50.0) == -4.0  # bed wins over NoData
    assert sampler_hole(5.0, 5.0) is None  # outside, DEM still NoData


def test_no_polygons_is_a_pass_through_to_the_dem() -> None:
    """With no bed polygons the sampler is exactly the DEM."""
    sampler = ground_sampler_with_bed(_flat_dem(2.0), [])
    assert sampler(50.0, 50.0) == 2.0
    assert sampler(5.0, 5.0) == 2.0


def test_a_point_on_the_line_between_two_flanks_crosses_the_polygon() -> None:
    """A section crossing the canal shows the bed only across the polygon span.

    Walking x from 0 to 100 at y = 50, the ground reads the DEM on the flanks
    and the bed level in the 40..60 span — which is the section DEM line
    showing the bed where the section crosses the polygon.
    """
    sampler = ground_sampler_with_bed(_flat_dem(2.0), [_CANAL])
    profile = [sampler(x, 50.0) for x in range(0, 101, 10)]
    # x = 0,10,20,30 → DEM; 40,50,60 → bed; 70,80,90,100 → DEM.
    assert profile[0:4] == [2.0, 2.0, 2.0, 2.0]
    assert profile[4:7] == [-4.0, -4.0, -4.0]
    assert profile[7:] == [2.0, 2.0, 2.0, 2.0]


def test_the_first_containing_polygon_wins_when_they_overlap() -> None:
    """Overlapping polygons resolve by order — the first containing one wins."""
    a = BedOverridePolygon(
        label="A", level_m=-4.0, vertices=[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    )
    b = BedOverridePolygon(
        label="B", level_m=-9.0, vertices=[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    )
    assert bed_level_at([a, b], 5.0, 5.0) == -4.0
    assert bed_level_at([b, a], 5.0, 5.0) == -9.0
