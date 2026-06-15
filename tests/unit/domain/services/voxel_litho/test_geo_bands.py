"""Behavioural tests for ``geo_bands`` — geological-band geometry helpers.

The helpers decide which geological band a 3-D point belongs to, what the
elevation bounds of each band are, and whether an investigation's observed
stack reaches a given band at all.  Comments are phrased in geological terms
(band above a surface, band bounded between two surfaces, open deepest band)
rather than implementation-variable terms, so a regression reads as a clear
break of the stratigraphic rule the helper must enforce.

Fixture
-------
Two horizontal geological surfaces (flat TINs) define three bands:

    Band 0  (above every surface)         —  z > −2 m
    Band 1  (between the two surfaces)    —  −8 m < z ≤ −2 m
    Band 2  (below every surface)         —  z ≤ −8 m

The surfaces are expressed as minimal flat TINs (two right-triangle faces per
plane so ``SurfaceBound`` is valid) at fixed elevations −2 m and −8 m.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.strat_field.strat_types import SurfaceBound
from groundmodel.domain.services.voxel_litho.geo_bands import (
    band_extent,
    band_of,
    section_reaches_band,
)

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _flat_tin(z: float) -> SurfaceBound:
    """Return a minimal flat horizontal TIN at elevation ``z``.

    Four corner vertices at (0,0), (1,0), (1,1), (0,1) — two triangles.
    The TIN covers the unit square; any query point falls inside this footprint
    so ``evaluate`` uses barycentric interpolation, not the nearest-vertex fallback.
    """
    verts: list[tuple[float, float, float]] = [
        (0.0, 0.0, z),
        (1.0, 0.0, z),
        (1.0, 1.0, z),
        (0.0, 1.0, z),
    ]
    tris: list[tuple[int, int, int]] = [(0, 1, 2), (0, 2, 3)]
    return SurfaceBound(vertices=verts, triangles=tris)


# Two geological surfaces at z = −2 m and z = −8 m, defining three bands.
_SURF_MINUS_2 = _flat_tin(-2.0)
_SURF_MINUS_8 = _flat_tin(-8.0)
# Always pass as a tuple (the required type for all three helpers).
_SURFACES: tuple[SurfaceBound, ...] = (_SURF_MINUS_2, _SURF_MINUS_8)

# A query point inside the unit square (so the TIN interpolation is exact).
_X, _Y = 0.5, 0.5


# ---------------------------------------------------------------------------
# band_of — band index from a query elevation
# ---------------------------------------------------------------------------


class TestBandOf:
    """``band_of`` returns the index of the geological band a point falls in.

    The rule: band index = number of surfaces whose elevation at ``(x, y)`` is
    strictly ABOVE ``z``.  Band 0 is above every surface; band
    ``len(surfaces)`` is below every surface.  Strict ``>`` means a point
    exactly ON a surface boundary belongs to the DEEPER band (the band below it).
    """

    def test_above_top_surface_is_band_0(self) -> None:
        """A point well above the top geological surface belongs to band 0."""
        assert band_of(_SURFACES, _X, _Y, z=0.0) == 0

    def test_just_above_top_surface_is_band_0(self) -> None:
        """A point just above the top surface (z = −1.9 m) is still in band 0."""
        assert band_of(_SURFACES, _X, _Y, z=-1.9) == 0

    def test_on_top_surface_is_band_0(self) -> None:
        """A point exactly on the top surface (z = −2 m) is in band 0 (shallower band).

        The band rule uses strict ``>``: a surface at the SAME elevation as the
        query is NOT counted as being above it, so the count is not incremented.
        The point therefore sits in band 0 (zero surfaces strictly above it).
        """
        assert band_of(_SURFACES, _X, _Y, z=-2.0) == 0

    def test_between_surfaces_is_band_1(self) -> None:
        """A point between the two geological surfaces belongs to band 1."""
        assert band_of(_SURFACES, _X, _Y, z=-5.0) == 1

    def test_on_bottom_surface_is_band_1(self) -> None:
        """A point exactly on the bottom surface (z = −8 m) is in band 1 (shallower band).

        With strict ``>``: the bottom surface at −8 m is NOT strictly above
        z = −8 m, so only the top surface (at −2 m) is counted.  The result
        is band 1 (one surface strictly above it), not band 2.
        """
        assert band_of(_SURFACES, _X, _Y, z=-8.0) == 1

    def test_below_bottom_surface_is_band_2(self) -> None:
        """A point well below every geological surface belongs to band 2 (deepest band)."""
        assert band_of(_SURFACES, _X, _Y, z=-20.0) == 2

    def test_no_surfaces_everything_is_band_0(self) -> None:
        """When no geological surfaces exist, every elevation is in band 0."""
        assert band_of((), _X, _Y, z=5.0) == 0
        assert band_of((), _X, _Y, z=-100.0) == 0

    def test_single_surface_above_returns_0(self) -> None:
        """Single surface: a point above it is band 0."""
        assert band_of((_SURF_MINUS_2,), _X, _Y, z=0.0) == 0

    def test_single_surface_below_returns_1(self) -> None:
        """Single surface: a point below it is band 1."""
        assert band_of((_SURF_MINUS_2,), _X, _Y, z=-5.0) == 1

    def test_unsorted_surfaces_produce_same_result(self) -> None:
        """Surface order in the tuple does not change the band assignment.

        The count rule (how many surfaces are above z) is order-independent.
        Reversing the input tuple must give the same result for every query.
        """
        reversed_surfaces = (_SURF_MINUS_8, _SURF_MINUS_2)
        for z in [0.0, -1.9, -2.0, -5.0, -8.0, -20.0]:
            assert band_of(reversed_surfaces, _X, _Y, z=z) == band_of(_SURFACES, _X, _Y, z=z), (
                f"mismatch at z={z}"
            )


# ---------------------------------------------------------------------------
# band_extent — elevation bounds of a given band at (x, y)
# ---------------------------------------------------------------------------


class TestBandExtent:
    """``band_extent`` returns (base_elev, top_elev) of a geological band.

    Convention:
    * ``top_elev`` is the elevation of the surface ABOVE the band
      (i.e. the lower bound of the surface), or ``None`` for the shallowest
      band (open upward).
    * ``base_elev`` is the elevation of the surface BELOW the band
      (i.e. the upper bound of the next surface), or ``None`` for the deepest
      band (open downward).
    * A ``z`` strictly inside ``(base_elev, top_elev)`` must satisfy
      ``band_of(surfaces, x, y, z) == band``.

    Open bounds are ``None`` (not a sentinel float) — callers treat ``None``
    as ±∞ respectively.
    """

    def test_shallowest_band_has_none_top(self) -> None:
        """Band 0 is open above: its top bound is ``None``."""
        base, top = band_extent(_SURFACES, _X, _Y, band=0)
        assert top is None, "shallowest band has no upper geological surface"

    def test_shallowest_band_base_is_top_surface_elevation(self) -> None:
        """Band 0's base is the elevation of the top geological surface (−2 m)."""
        base, top = band_extent(_SURFACES, _X, _Y, band=0)
        assert base == pytest.approx(-2.0)

    def test_middle_band_base_is_bottom_surface_elevation(self) -> None:
        """Band 1's base is the elevation of the bottom geological surface (−8 m)."""
        base, top = band_extent(_SURFACES, _X, _Y, band=1)
        assert base == pytest.approx(-8.0)

    def test_middle_band_top_is_top_surface_elevation(self) -> None:
        """Band 1's top is the elevation of the top geological surface (−2 m)."""
        base, top = band_extent(_SURFACES, _X, _Y, band=1)
        assert top == pytest.approx(-2.0)

    def test_deepest_band_has_none_base(self) -> None:
        """Band 2 is open below: its base bound is ``None``."""
        base, top = band_extent(_SURFACES, _X, _Y, band=2)
        assert base is None, "deepest band has no lower geological surface"

    def test_deepest_band_top_is_bottom_surface_elevation(self) -> None:
        """Band 2's top is the elevation of the bottom geological surface (−8 m)."""
        base, top = band_extent(_SURFACES, _X, _Y, band=2)
        assert top == pytest.approx(-8.0)

    def test_band_extent_consistent_with_band_of_interior(self) -> None:
        """Any z strictly inside a band's (base, top) must belong to that band.

        This verifies the convention is self-consistent: ``band_of`` and
        ``band_extent`` must agree that the middle of each band is in that band.
        """
        for band_idx in range(3):
            base, top = band_extent(_SURFACES, _X, _Y, band=band_idx)
            # Use the midpoint of a finite interval; for open bounds use a
            # representative point clearly inside the open half.
            if top is None:
                # Shallowest open top: pick a point clearly above the base.
                assert base is not None
                z_mid = base + 3.0
            elif base is None:
                # Deepest open base: pick a point clearly below the top.
                z_mid = top - 3.0
            else:
                z_mid = (base + top) / 2.0
            assert band_of(_SURFACES, _X, _Y, z=z_mid) == band_idx, (
                f"midpoint z={z_mid} of band {band_idx} "
                f"[base={base}, top={top}] resolves to wrong band"
            )

    def test_no_surfaces_single_band_0_is_fully_open(self) -> None:
        """With no geological surfaces, band 0 is fully open: (None, None)."""
        base, top = band_extent((), _X, _Y, band=0)
        assert base is None
        assert top is None

    def test_single_surface_band_0_open_top(self) -> None:
        """Single surface at −2 m: band 0 has top=None, base=−2 m."""
        base, top = band_extent((_SURF_MINUS_2,), _X, _Y, band=0)
        assert top is None
        assert base == pytest.approx(-2.0)

    def test_single_surface_band_1_open_base(self) -> None:
        """Single surface at −2 m: band 1 has top=−2 m, base=None."""
        base, top = band_extent((_SURF_MINUS_2,), _X, _Y, band=1)
        assert top == pytest.approx(-2.0)
        assert base is None

    def test_unsorted_surfaces_give_correct_ordering(self) -> None:
        """Surfaces given in reverse elevation order are sorted by band_extent.

        The two surfaces must be sorted by elevation at the query point so that
        band 0 is above both, band 1 is between them, and band 2 is below both.
        Regardless of input order, band 1's extent must be (−8 m, −2 m).
        """
        reversed_surfaces = (_SURF_MINUS_8, _SURF_MINUS_2)
        base, top = band_extent(reversed_surfaces, _X, _Y, band=1)
        assert base == pytest.approx(-8.0)
        assert top == pytest.approx(-2.0)


# ---------------------------------------------------------------------------
# section_reaches_band — does the investigation's observed stack reach a band?
# ---------------------------------------------------------------------------


def _stack(*intervals: tuple[str, str, float, float]) -> tuple[tuple[str, str, float, float], ...]:
    """Build an ``intervals`` tuple for readability in test bodies."""
    return intervals


class TestSectionReachesBand:
    """``section_reaches_band`` checks whether a stack overlaps a geological band.

    A stack is a tuple of ``(body_id, formation_id, top_elev, base_elev)``
    intervals (``top_elev >= base_elev``).  The function returns True iff at
    least one interval's ``[base_elev, top_elev]`` overlaps the band's extent
    by more than a tiny epsilon (a mere boundary touch is NOT counted as reaching
    the band).

    Band extents follow the ``band_extent`` convention:
    * Band 0 top = None (open upward)  / base = −2 m
    * Band 1 top = −2 m                / base = −8 m
    * Band 2 top = −8 m                / base = None (open downward)
    """

    def test_interval_fully_inside_band_reaches_it(self) -> None:
        """An interval wholly within band 1 (−8 m to −2 m) reaches band 1."""
        stack = _stack(("b1", "KLEI", -3.0, -7.0))  # entirely inside band 1
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is True

    def test_interval_in_different_band_does_not_reach(self) -> None:
        """An interval wholly inside band 0 does NOT reach band 1."""
        stack = _stack(("b0", "SAND", 5.0, 1.0))  # entirely in band 0 (above −2 m)
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is False

    def test_interval_straddling_boundary_reaches_band_below(self) -> None:
        """An interval that straddles the top geological surface reaches band 1.

        The interval from +1 m to −5 m crosses the −2 m surface, so it
        overlaps band 1 (−8 m to −2 m) by 3 m.
        """
        stack = _stack(("b0", "KLEI", 1.0, -5.0))
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is True

    def test_interval_straddling_boundary_reaches_band_above(self) -> None:
        """The same interval also reaches band 0 (open above −2 m)."""
        stack = _stack(("b0", "KLEI", 1.0, -5.0))
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=0) is True

    def test_interval_exactly_touching_band_boundary_does_not_reach(self) -> None:
        """An interval whose base EXACTLY touches the top of band 1 does NOT reach band 1.

        The interval stops at −2 m (the boundary) — it merely touches band 1
        from above.  The epsilon guard means a zero-overlap touch is rejected.
        """
        stack = _stack(("b0", "SAND", 0.0, -2.0))  # base == top of band 1
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is False

    def test_interval_exactly_touching_band_1_from_below_does_not_reach(self) -> None:
        """An interval whose top EXACTLY touches the base of band 1 does NOT reach band 1.

        The interval sits entirely in band 2 (its top is at −8 m, the bottom
        of band 1).  A mere boundary touch at −8 m is not a meaningful overlap.
        """
        stack = _stack(("b2", "KLEI", -8.0, -15.0))  # top == base of band 1
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is False

    def test_empty_stack_reaches_no_band(self) -> None:
        """An empty observation stack reaches no band."""
        for band_idx in range(3):
            assert section_reaches_band((), _SURFACES, _X, _Y, band=band_idx) is False

    def test_open_deepest_band_reached_by_deep_interval(self) -> None:
        """An interval that goes far below −8 m reaches the open deepest band (band 2)."""
        stack = _stack(("b2", "KLEI", -9.0, -30.0))
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=2) is True

    def test_open_shallowest_band_reached_by_shallow_interval(self) -> None:
        """An interval well above −2 m reaches the open shallowest band (band 0)."""
        stack = _stack(("b0", "SAND", 10.0, 5.0))
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=0) is True

    def test_multiple_intervals_any_overlap_is_enough(self) -> None:
        """With multiple intervals, just ONE overlapping band 1 is sufficient."""
        stack = _stack(
            ("b0", "SAND", 5.0, 1.0),  # in band 0 only
            ("b1", "KLEI", -3.0, -7.0),  # in band 1
            ("b2", "VEEN", -9.0, -15.0),  # in band 2 only
        )
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is True

    def test_no_surfaces_whole_stack_reaches_band_0(self) -> None:
        """With no geological surfaces, the only band is 0 and everything reaches it."""
        stack = _stack(("b0", "KLEI", 5.0, -50.0))
        assert section_reaches_band(stack, (), _X, _Y, band=0) is True

    def test_interval_overlaps_open_top_band_from_deep(self) -> None:
        """An interval deep in band 0 (not near the surface) still reaches band 0."""
        # Band 0 is above −2 m (open top); an interval from +1 to −1 is entirely in band 0.
        stack = _stack(("b0", "SAND", 1.0, -1.0))
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=0) is True
        # But that interval does NOT reach band 1 (it barely misses the −2 m boundary).
        assert section_reaches_band(stack, _SURFACES, _X, _Y, band=1) is False
