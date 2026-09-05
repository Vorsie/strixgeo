"""Unit tests for the CRS-bounds classifier.

The classifier answers whether a projected ``(x, y)`` falls inside the area
its declared coordinate reference system covers, so a swapped X/Y, a wrong
EPSG, or a foreign position is caught at import instead of appearing as a dot
in the sea (owner ruling 2026-09-05).

All numeric anchors below were verified against ``pyproj``'s ``area_of_use``
for the named EPSG (BD72 / Belgian Lambert 72 = 31370, Amersfoort / RD New =
28992) — see the probe in the accompanying build report.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.crs_bounds import (
    CrsBoundsResult,
    classify_coordinates,
)


class TestClassifyInsideOutside:
    def test_coordinates_inside_the_declared_systems_area_answer_inside(self) -> None:
        # A real Belgian Lambert 72 sounding (Brussels-ish easting/northing).
        assert classify_coordinates(31370, 200000.0, 100000.0) == CrsBoundsResult.INSIDE

    def test_coordinates_outside_the_declared_systems_area_answer_outside(self) -> None:
        # Amsterdam RD New easting/northing declared as Belgian Lambert 72:
        # the northing (487000) sits far north of Belgium's coverage.
        assert classify_coordinates(31370, 121000.0, 487000.0) == CrsBoundsResult.OUTSIDE

    def test_swapped_x_and_y_answer_outside(self) -> None:
        # (265000, 145000) is a real far-east Belgian point; swapping the two
        # puts the northing at 265000, past Belgium's maximum → outside.
        assert classify_coordinates(31370, 145000.0, 265000.0) == CrsBoundsResult.OUTSIDE

    def test_check_is_not_belgium_specific(self) -> None:
        # RD New: an Amsterdam point reads inside, a Belgian Lambert point does
        # not — the classifier reads the declared system's own area, whatever it
        # is.
        assert classify_coordinates(28992, 121000.0, 487000.0) == CrsBoundsResult.INSIDE
        assert classify_coordinates(28992, 200000.0, 100000.0) == CrsBoundsResult.OUTSIDE


class TestClassifyUnknownSystem:
    def test_a_missing_system_answers_unknown(self) -> None:
        assert classify_coordinates(None, 200000.0, 100000.0) == CrsBoundsResult.UNKNOWN

    def test_an_unresolvable_epsg_answers_unknown(self) -> None:
        # A code pyproj cannot turn into a CRS must skip the check, never crash
        # the parse.
        assert classify_coordinates(999999, 200000.0, 100000.0) == CrsBoundsResult.UNKNOWN

    def test_missing_coordinates_answer_unknown(self) -> None:
        assert classify_coordinates(31370, None, 100000.0) == CrsBoundsResult.UNKNOWN
        assert classify_coordinates(31370, 200000.0, None) == CrsBoundsResult.UNKNOWN


class TestClassifyMargin:
    def test_a_point_a_few_hundred_metres_past_the_boundary_is_not_flagged(self) -> None:
        # Belgium's projected coverage bottoms out near northing 20906 m; a
        # point 200 m below it stays inside on the tolerance margin.
        assert classify_coordinates(31370, 150000.0, 20706.0) == CrsBoundsResult.INSIDE

    def test_a_point_well_past_the_boundary_is_flagged(self) -> None:
        # 2 km below the same edge is past the margin → outside.
        assert classify_coordinates(31370, 150000.0, 18906.0) == CrsBoundsResult.OUTSIDE
