"""Behavioural tests for the geological band partition (``geo_blocks``).

The litho field is fit WITHIN each geological band (owner directive
2026-06-11: "geology prevails — litho interfingers ONLY within each
geological unit").  These tests pin the band-assignment, the snap-or-divide
rule on a litho contact near a geological surface, and the shared-surface
invariant between adjacent band blocks.

Comments are phrased in the owner's vocabulary (band, geological surface,
snap, divide, straddle) rather than in implementation terms, so a regression
reads as a clear contract break.

Fixtures use two flat geological surfaces at Lambert-72-ish horizontal
magnitude (so band membership is exactly decidable) and picks that land in
distinct bands, one near-coincident with a surface (snap) and one whose
elevation span crosses a surface deeper than tolerance (divide).
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.strat_field.geo_blocks import (
    band_blocks,
    partition_picks_by_geology,
)
from groundmodel.domain.services.strat_field.strat_types import SurfaceBound

# Two flat geological surfaces over a Lambert-72-ish footprint.  Surface "GEO_A"
# at elevation 0 m (shallower), "GEO_B" at -20 m (deeper).  Three bands result:
# band 0 above 0 m, band 1 between 0 m and -20 m, band 2 below -20 m.
_X0, _Y0 = 150_000.0, 200_000.0
_SPAN = 1_000.0


def _flat_geo_surface(formation_id: str, elevation: float) -> SurfaceBound:
    """A flat horizontal geological surface at ``elevation`` over the footprint."""
    return SurfaceBound(
        vertices=[
            (_X0, _Y0, elevation),
            (_X0 + _SPAN, _Y0, elevation),
            (_X0, _Y0 + _SPAN, elevation),
            (_X0 + _SPAN, _Y0 + _SPAN, elevation),
        ],
        triangles=[(0, 1, 2), (1, 3, 2)],
    )


def _two_geo_surfaces() -> list[SurfaceBound]:
    """Two flat geological surfaces → three bands (0 m and -20 m)."""
    return [_flat_geo_surface("GEO_A", 0.0), _flat_geo_surface("GEO_B", -20.0)]


def _pick(
    body_id: str,
    *,
    surface_elev_m: float,
    top_depth_m: float,
    base_depth_m: float,
    formation_id: str = "ZAND",
    investigation_id: str = "inv1",
) -> BodyLayerPick:
    """One body member-layer pick at the footprint centre."""
    return BodyLayerPick(
        investigation_id=investigation_id,
        x_m=_X0 + 0.5 * _SPAN,
        y_m=_Y0 + 0.5 * _SPAN,
        surface_elev_m=surface_elev_m,
        body_id=body_id,
        formation_id=formation_id,
        top_depth_m=top_depth_m,
        base_depth_m=base_depth_m,
    )


def test_pick_assigned_to_its_band():
    """Each pick lands in the band its mid-elevation falls into.

    Surface elevation 10 m: a 0–4 m layer has mid-elevation +8 m (above both
    surfaces → band 0); a 12–16 m layer has mid +(-4) m (between → band 1); a
    28–32 m layer has mid -20...→ below -20 m → band 2.
    """
    picks = [
        _pick("body_top", surface_elev_m=10.0, top_depth_m=0.0, base_depth_m=4.0),
        _pick("body_mid", surface_elev_m=10.0, top_depth_m=12.0, base_depth_m=16.0),
        _pick("body_bot", surface_elev_m=10.0, top_depth_m=32.0, base_depth_m=36.0),
    ]
    bands = partition_picks_by_geology(picks, _two_geo_surfaces(), snap_tolerance_m=0.2)

    assert set(bands) == {0, 1, 2}
    assert {p.body_id for p in bands[0]} == {"body_top"}
    assert {p.body_id for p in bands[1]} == {"body_mid"}
    assert {p.body_id for p in bands[2]} == {"body_bot"}


def test_contact_within_tolerance_snaps_to_geo_surface():
    """A litho contact within tolerance of a geological surface snaps to it.

    A pick whose base sits 0.1 m above the -20 m surface (within the 0.2 m
    tolerance) must NOT create a spurious thin sliver in band 2 — the whole
    pick stays in band 1, snapped to the boundary.
    """
    # surface_elev 0 m → depth equals -elevation.  top at -4 m (depth 4),
    # base at -19.9 m (depth 19.9): the base is 0.1 m above the -20 m surface.
    picks = [_pick("body_snap", surface_elev_m=0.0, top_depth_m=4.0, base_depth_m=19.9)]
    bands = partition_picks_by_geology(picks, _two_geo_surfaces(), snap_tolerance_m=0.2)

    # No band-2 sliver: the pick stays whole in band 1.
    assert 2 not in bands or all(p.body_id != "body_snap" for p in bands.get(2, []))
    assert [p.body_id for p in bands[1]] == ["body_snap"]
    # Snapped means "no cut" — geology defers to the observed litho contact, so
    # the pick keeps its own base depth (no spurious sliver across the boundary)
    # rather than being yanked to the exact geological elevation.
    snapped = bands[1][0]
    assert snapped.surface_elev_m - snapped.base_depth_m == pytest.approx(-19.9)


def test_straddling_pick_divides_at_boundary():
    """A pick crossing a geological surface by more than tolerance is split.

    surface_elev 0 m, top at -4 m (depth 4), base at -30 m (depth 30): the span
    crosses the -20 m surface by 10 m (≫ tolerance) → divide into a band-1 part
    (-4 m … -20 m) and a band-2 part (-20 m … -30 m).
    """
    picks = [_pick("body_straddle", surface_elev_m=0.0, top_depth_m=4.0, base_depth_m=30.0)]
    bands = partition_picks_by_geology(picks, _two_geo_surfaces(), snap_tolerance_m=0.2)

    assert 1 in bands and 2 in bands
    upper = [p for p in bands[1] if p.body_id.startswith("body_straddle")]
    lower = bands[2]
    # The two parts meet exactly at the -20 m geological surface.
    upper_part = bands[1][0]
    lower_part = lower[0]
    assert upper_part.surface_elev_m - upper_part.base_depth_m == pytest.approx(-20.0)
    assert lower_part.surface_elev_m - lower_part.top_depth_m == pytest.approx(-20.0)
    # The upper part starts where the original layer started.
    assert upper_part.surface_elev_m - upper_part.top_depth_m == pytest.approx(-4.0)
    assert lower_part.surface_elev_m - lower_part.base_depth_m == pytest.approx(-30.0)
    assert upper  # band-1 part exists


def test_coincident_geo_surfaces_emit_no_zero_thickness_segment():
    """Two geological surfaces coincident at a pick's (x, y) emit no zero sliver.

    When two surfaces sit at the (near-)same elevation under a pick, that
    elevation enters the cut list twice; without a coincidence guard the
    straddling span is divided AT IT TWICE, producing a degenerate part whose
    top and base are the same — a zero-thickness pick that would become a
    degenerate control point downstream.  Every emitted pick must have real
    positive thickness (base_depth_m > top_depth_m by more than the numeric
    guard; depths are positive-down, so thickness = base - top).
    """
    # Both surfaces at -10 m → coincident at every (x, y).  A pick spanning
    # -4 m … -30 m crosses the coincident surfaces by ≫ tolerance, so each
    # would be a cut → two identical cuts at -10 m without the dedup guard.
    surfaces = [_flat_geo_surface("GEO_A", -10.0), _flat_geo_surface("GEO_B", -10.0)]
    picks = [_pick("body_co", surface_elev_m=0.0, top_depth_m=4.0, base_depth_m=30.0)]

    bands = partition_picks_by_geology(picks, surfaces, snap_tolerance_m=0.2)

    emitted = [p for band in bands.values() for p in band]
    assert emitted, "the pick must still be partitioned, not dropped entirely"
    # No zero- or negative-thickness pick survived the partition.
    for p in emitted:
        thickness = p.base_depth_m - p.top_depth_m
        assert thickness > 1e-6, f"degenerate zero-thickness pick emitted: {p!r}"


def _hull() -> tuple[tuple[float, float], ...]:
    """The footprint polygon used for band blocks."""
    return (
        (_X0, _Y0),
        (_X0 + _SPAN, _Y0),
        (_X0 + _SPAN, _Y0 + _SPAN),
        (_X0, _Y0 + _SPAN),
    )


def test_band_block_carries_surface_bounds():
    """band_blocks builds one surface-bounded Block per band, top→bottom.

    The outermost open bounds stay flat (top band's top = z_max, bottom band's
    base = z_min); interior bounds are the geological surfaces.  Adjacent bands
    SHARE the geological surface (top of band k+1 == base of band k).
    """
    surfaces = _two_geo_surfaces()
    blocks = band_blocks(surfaces, _hull(), z_min=-50.0, z_max=20.0)

    assert len(blocks) == 3  # two surfaces → three bands

    # Top band: flat top (open), curved base.
    assert blocks[0].top_surface is None
    assert blocks[0].base_surface is not None
    assert blocks[0].z_max == pytest.approx(20.0)

    # Middle band: curved top AND curved base.
    assert blocks[1].top_surface is not None
    assert blocks[1].base_surface is not None

    # Bottom band: curved top, flat base (open).
    assert blocks[2].top_surface is not None
    assert blocks[2].base_surface is None
    assert blocks[2].z_min == pytest.approx(-50.0)

    # Adjacent bands SHARE the surface: blocks[0].base == blocks[1].top.
    sample_x, sample_y = _X0 + 0.5 * _SPAN, _Y0 + 0.5 * _SPAN
    assert blocks[0].base_surface.evaluate(sample_x, sample_y) == pytest.approx(
        blocks[1].top_surface.evaluate(sample_x, sample_y)
    )
    assert blocks[1].base_surface.evaluate(sample_x, sample_y) == pytest.approx(
        blocks[2].top_surface.evaluate(sample_x, sample_y)
    )
    # The shared surfaces are the geological surfaces (0 m and -20 m), ordered.
    assert blocks[0].base_surface.evaluate(sample_x, sample_y) == pytest.approx(0.0)
    assert blocks[1].base_surface.evaluate(sample_x, sample_y) == pytest.approx(-20.0)
