"""Equivalence pins for the precomputed-elevation ``geo_bands`` variants.

The ``*_from_elevs`` helpers are a PURE-SPEED optimisation: they compute the
exact same band index / band extent / reach decision as
:func:`band_of` / :func:`band_extent` / :func:`section_reaches_band`, but take
the four geological-surface elevations at ``(x, y)`` as a precomputed tuple of
floats instead of re-evaluating the TIN.  The point of the optimisation is to
evaluate each surface's TIN ONCE per column instead of ~60-100× per column.

These tests are the byte-identical safety net: for a random sweep of query
points the ``*_from_elevs`` variant MUST return a result that compares EQUAL to
its TIN-evaluating original — the band assignment cannot drift by a single
boundary classification.  Because both paths obtain the surface elevations from
the SAME ``surf.evaluate(x, y)`` call, the floats are bit-identical and the
``>`` / sort / bounding-pair comparisons see the same values.

Fixture: tilted (non-flat) TINs so ``evaluate`` actually varies with ``(x, y)``
— a flat fixture would hide an ordering bug that only fires when two surfaces
swap rank across the footprint.
"""

from __future__ import annotations

import random

import pytest

from groundmodel.domain.services.strat_field.strat_types import SurfaceBound
from groundmodel.domain.services.voxel_litho.geo_bands import (
    band_extent,
    band_extent_from_elevs,
    band_of,
    band_of_from_elevs,
    section_reaches_band,
    section_reaches_band_from_elevs,
)

# ---------------------------------------------------------------------------
# Fixture: tilted surfaces so evaluate varies with (x, y)
# ---------------------------------------------------------------------------


def _tilted_tin(z00: float, z10: float, z11: float, z01: float) -> SurfaceBound:
    """A TIN over the unit square with a different elevation at each corner.

    Tilting the surface makes ``evaluate(x, y)`` vary across the footprint, so a
    random (x, y) sweep exercises the descending-elevation sort + bounding-pair
    pick on genuinely-different float values (not the degenerate flat case).
    """
    verts: list[tuple[float, float, float]] = [
        (0.0, 0.0, z00),
        (1.0, 0.0, z10),
        (1.0, 1.0, z11),
        (0.0, 1.0, z01),
    ]
    tris: list[tuple[int, int, int]] = [(0, 1, 2), (0, 2, 3)]
    return SurfaceBound(vertices=verts, triangles=tris)


# Two tilted surfaces whose mean elevations differ but which tilt the OPPOSITE
# way, so somewhere over the footprint they get close — stressing the sort.
_SURF_UPPER = _tilted_tin(-1.0, -3.0, -2.5, -0.5)
_SURF_LOWER = _tilted_tin(-9.0, -7.0, -7.5, -9.5)
_SURFACES: tuple[SurfaceBound, ...] = (_SURF_UPPER, _SURF_LOWER)


def _surf_elevs(surfaces: tuple[SurfaceBound, ...], x: float, y: float) -> tuple[float, ...]:
    """The precomputed-elevation tuple the caller would build once per column.

    Uses the SAME ``surf.evaluate(x, y)`` call the originals use, so the floats
    are bit-identical and no comparison can drift.
    """
    return tuple(s.evaluate(x, y) for s in surfaces)


_SAMPLE_POINTS: list[tuple[float, float]] = [
    (random.Random(seed).uniform(0.0, 1.0), random.Random(seed + 7919).uniform(0.0, 1.0))
    for seed in range(200)
]
_SAMPLE_ELEVS = [-15.0, -9.5, -8.0, -5.0, -3.0, -2.0, -0.5, 0.0, 5.0]


class TestBandOfFromElevs:
    """``band_of_from_elevs`` equals ``band_of`` for every sampled point."""

    def test_band_of_from_elevs_matches_tin_path(self) -> None:
        """Precomputed-elevation band index == TIN-evaluating band index, every point.

        For a 200-point random sweep × 9 query elevations, the band assignment
        must be IDENTICAL — a single off-by-one band would mislabel voxels.
        """
        for x, y in _SAMPLE_POINTS:
            elevs = _surf_elevs(_SURFACES, x, y)
            for z in _SAMPLE_ELEVS:
                expected = band_of(_SURFACES, x, y, z)
                actual = band_of_from_elevs(elevs, z)
                assert actual == expected, f"band mismatch at ({x},{y},{z})"

    def test_band_of_from_elevs_empty_surfaces_is_band_0(self) -> None:
        """No surfaces → an empty elevation tuple → everything is band 0."""
        assert band_of_from_elevs((), z=5.0) == 0
        assert band_of_from_elevs((), z=-100.0) == 0


class TestBandExtentFromElevs:
    """``band_extent_from_elevs`` equals ``band_extent`` for every band."""

    def test_band_extent_from_elevs_matches_tin_path(self) -> None:
        """Precomputed-elevation extent == TIN-evaluating extent, every band.

        Both the open-bound (``None``) handling and the finite bounding-surface
        elevations must match exactly across all ``len(surfaces) + 1`` bands.
        """
        for x, y in _SAMPLE_POINTS:
            elevs = _surf_elevs(_SURFACES, x, y)
            for band in range(len(_SURFACES) + 1):
                expected = band_extent(_SURFACES, x, y, band)
                actual = band_extent_from_elevs(elevs, band)
                assert actual == expected, f"extent mismatch at ({x},{y}) band {band}"

    def test_band_extent_from_elevs_no_surfaces_fully_open(self) -> None:
        """No surfaces → band 0 is fully open: (None, None)."""
        assert band_extent_from_elevs((), band=0) == (None, None)

    def test_band_extent_from_elevs_preserves_descending_sort(self) -> None:
        """An out-of-elevation-order tuple is sorted descending, like the TIN path.

        ``band_extent`` sorts surfaces shallowest-first at the query point; the
        ``_from_elevs`` variant must sort the precomputed floats the same way so
        the bounding-pair pick is identical regardless of input ordering.
        """
        # Surfaces deliberately listed deep-first; band 1's extent must still be
        # (lower elevation, upper elevation) = (the deeper float, the shallower).
        elevs = (-8.0, -2.0)  # lower listed first
        base, top = band_extent_from_elevs(elevs, band=1)
        assert base == pytest.approx(-8.0)
        assert top == pytest.approx(-2.0)


class TestSectionReachesBandFromElevs:
    """``section_reaches_band_from_elevs`` equals ``section_reaches_band``."""

    def test_section_reaches_band_from_elevs_matches_tin_path(self) -> None:
        """Precomputed-elevation reach decision == TIN-evaluating decision.

        For a representative stack at every sampled point and band, the boolean
        reach decision must be identical — the sideways-fill drop of a
        non-reaching section hinges on this exact predicate.
        """
        stack = (
            ("b0", "SAND", 2.0, -1.5),
            ("b1", "KLEI", -1.5, -6.0),
            ("b2", "VEEN", -6.0, -12.0),
        )
        for x, y in _SAMPLE_POINTS:
            elevs = _surf_elevs(_SURFACES, x, y)
            for band in range(len(_SURFACES) + 1):
                expected = section_reaches_band(stack, _SURFACES, x, y, band)
                actual = section_reaches_band_from_elevs(stack, elevs, band)
                assert actual == expected, f"reach mismatch at ({x},{y}) band {band}"

    def test_section_reaches_band_from_elevs_empty_stack_reaches_nothing(self) -> None:
        """An empty stack reaches no band on the precomputed path either."""
        elevs = _surf_elevs(_SURFACES, 0.5, 0.5)
        for band in range(len(_SURFACES) + 1):
            assert section_reaches_band_from_elevs((), elevs, band) is False
