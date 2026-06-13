"""Behavioural tests for ``loft_field`` — the two-nearest blend stack field.

The comments are phrased in the spec's vocabulary ("equidistance midline",
"between vs beyond", "the tiling is always complete") rather than in
implementation terms, so a regression in the algorithm reads as a clear
contract break.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.loft_field import (
    BandSurface,
    LoftField,
    SectionInput,
    StackEntry,
)
from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.section_partition import PartitionPoint, SectionRegion

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _quad(body_id: str, formation_id: str, top: float, base: float, *, kind="quad", tier=None):
    """A full-gap-width region spanning [base, top] at every fraction."""
    poly = [
        PartitionPoint(0.0, top),
        PartitionPoint(1.0, top),
        PartitionPoint(1.0, base),
        PartitionPoint(0.0, base),
    ]
    return SectionRegion(
        formation_id=formation_id,
        body_id=body_id,
        kind=kind,
        polygon=poly,
        overlay_tier=tier,
        gap_index=0,
    )


def _sec1() -> SectionInput:
    """E-W section at y = -10; SAND 0..-5 over CLAY -5..-10."""
    return SectionInput(
        section_id="s1",
        ax=-20.0,
        ay=-10.0,
        bx=20.0,
        by=-10.0,
        column_alongs=(10.0, 30.0),
        regions=(
            _quad("b-sand", "SAND", 0.0, -5.0),
            _quad("b-clay", "CLAY", -5.0, -10.0),
        ),
    )


def _sec2() -> SectionInput:
    """E-W section at y = +10; SAND 0..-3 over CLAY -3..-10 (shallower interface)."""
    return SectionInput(
        section_id="s2",
        ax=-20.0,
        ay=10.0,
        bx=20.0,
        by=10.0,
        column_alongs=(10.0, 30.0),
        regions=(
            _quad("b-sand", "SAND", 0.0, -3.0),
            _quad("b-clay", "CLAY", -3.0, -10.0),
        ),
    )


def _sec1_with_lens() -> SectionInput:
    """Like ``_sec1`` but with a SILT lens (b-lens) between sand and clay."""
    return SectionInput(
        section_id="s1",
        ax=-20.0,
        ay=-10.0,
        bx=20.0,
        by=-10.0,
        column_alongs=(10.0, 30.0),
        regions=(
            _quad("b-sand", "SAND", 0.0, -5.0),
            _quad("b-lens", "SILT", -5.0, -7.0, kind="lens", tier="lens"),
            _quad("b-clay", "CLAY", -7.0, -10.0),
        ),
    )


def _dom():
    """A domain covering the section corridor; surface 0, base -12 everywhere."""
    tests = [
        DomainTest("t1", -25.0, -25.0, 0.0, -12.0),
        DomainTest("t2", 25.0, -25.0, 0.0, -12.0),
        DomainTest("t3", 25.0, 50.0, 0.0, -12.0),
        DomainTest("t4", -25.0, 50.0, 0.0, -12.0),
        DomainTest("t5", 0.0, 10.0, 0.0, -12.0),
    ]
    return build_model_domain(tests)


def _one_band():
    """A single geological band spanning the whole model depth [0, -12]."""
    return [BandSurface("BAND", lambda x, y: 0.0, lambda x, y: -12.0)]


def _thickness(stack: list[StackEntry], body_id: str) -> float:
    """Total vertical thickness of all entries carrying ``body_id``."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body_id)


def _sec1_sand_top_at(_along: float) -> float:
    """The SAND top on section 1 — flat at 0 mTAW."""
    return 0.0


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_node_on_a_section_reproduces_that_section_exactly():
    """A node ON a section reproduces that section's stack (weight 1)."""
    f = LoftField([_sec1(), _sec2()], domain=_dom())
    stack = f.stack_at(0.0, -10.0)  # a point ON section 1
    assert [s.body_id for s in stack] == ["b-sand", "b-clay"]
    assert stack[0].top_elev == pytest.approx(_sec1_sand_top_at(0.0))
    assert stack[0].base_elev == pytest.approx(-5.0)


def test_matched_body_blends_between_sections():
    """A body present on both sections blends its interface by inverse distance.

    sand/clay interface: -5 on section 1, -3 on section 2 → midway = -4.
    """
    f = LoftField([_sec1(), _sec2()], domain=_dom())
    stack = f.stack_at(0.0, 0.0)  # equidistant between the sections
    iface = next(s for s in stack if s.body_id == "b-sand").base_elev
    assert iface == pytest.approx(-4.0, abs=0.05)


def test_one_sided_body_pinches_to_zero_at_the_midline():
    """A body on one section but not its neighbour pinches to zero at the
    equidistance midline (spec decision 5)."""
    f = LoftField([_sec1_with_lens(), _sec2()], domain=_dom())
    near = f.stack_at(0.0, -7.5)  # closer to section 1 → lens present
    mid = f.stack_at(0.0, 0.0)  # the equidistance midline → lens gone
    assert _thickness(near, "b-lens") > 0
    assert _thickness(mid, "b-lens") == pytest.approx(0.0, abs=1e-9)


def test_one_sided_pinch_thickness_is_half_at_the_quarter_weight_point():
    """The one-sided pinch scales as max(0, 2*w_own - 1): at w_own = 0.75
    (node 1/4 of the way from its section) the lens keeps exactly half its
    thickness."""
    f = LoftField([_sec1_with_lens(), _sec2()], domain=_dom())
    # y=-5 is 5 m from sec1 (y=-10) and 15 m from sec2 (y=+10):
    # w_own = d_other/(d1+d2) = 15/20 = 0.75 → scale = 2*0.75-1 = 0.5.
    quarter = f.stack_at(0.0, -5.0)
    assert _thickness(quarter, "b-lens") == pytest.approx(1.0, abs=0.02)  # 2 m * 0.5


def test_beyond_last_section_band_extends_and_lens_pinches():
    """Beyond the far side of a section: BAND (quad) regions extend; ONLAP/LENS
    regions pinch at open_extent_length_m."""
    f = LoftField([_sec1_with_lens(), _sec2()], domain=_dom(), open_extent_length_m=3.0)
    beyond = f.stack_at(0.0, 14.0)  # 4 m past section 2 (the near one here)
    assert _thickness(beyond, "b-sand") > 0  # band continues
    assert _thickness(beyond, "b-lens") == 0.0  # lens long gone


def test_beyond_own_section_lens_ramps_over_open_extent_length():
    """Beyond a section's own side, its LENS thickness ramps to zero over
    open_extent_length_m while its BAND keeps full thickness."""
    f = LoftField([_sec1_with_lens(), _sec2()], domain=_dom(), open_extent_length_m=3.0)
    # (0,-12): 2 m past section 1 (its own side) → ramp = 1 - 2/3 = 1/3.
    beyond = f.stack_at(0.0, -12.0)
    assert _thickness(beyond, "b-lens") == pytest.approx(2.0 / 3.0, abs=0.02)  # 2 m * 1/3
    assert _thickness(beyond, "b-sand") == pytest.approx(5.0, abs=0.02)  # band full


def test_uncovered_band_volume_gets_the_band_filler_body():
    """A band sub-interval not covered by any litho region is filled by the
    band itself — the tiling is always complete.

    Here the SAND/CLAY bands extend (quad) to -10, so the uncovered [-10, -12]
    tail below the litho is what the band filler covers.
    """
    f = LoftField([_sec1()], domain=_dom(), band_surfaces=_one_band())
    stack = f.stack_at(0.0, 40.0)  # far outside the section corridor
    assert any(s.is_band_filler for s in stack)
    filler = next(s for s in stack if s.is_band_filler)
    assert filler.formation_id == "BAND"
    # the filler is the tail below the litho, down to the band base
    assert filler.top_elev == pytest.approx(-10.0)
    assert filler.base_elev == pytest.approx(-12.0)


def test_band_filler_closes_an_interior_hole_in_the_stack():
    """The band-clip fills a hole BETWEEN two covered entries, not only the
    tail.  The full pipeline never emits an interior hole (the cumulative
    layout is gap-free), so this pins the defensive branch directly: a
    hand-built non-contiguous stack must come back gap-free, band-filled."""
    from groundmodel.domain.services.loft_field import _clip_to_bands

    holey = [
        StackEntry("b-sand", "SAND", 0.0, -4.0),
        StackEntry("b-clay", "CLAY", -6.0, -10.0),  # hole [-4, -6] above it
    ]
    out = _clip_to_bands(holey, _one_band(), 0.0, 0.0)
    # the [-4, -6] hole must now be a BAND filler, and the [-10, -12] tail too
    interior = next(s for s in out if s.top_elev == pytest.approx(-4.0))
    assert interior.is_band_filler
    assert interior.formation_id == "BAND"
    assert interior.base_elev == pytest.approx(-6.0)
    # and the whole [0, -12] band is now tiled with no gaps
    for upper, lower in zip(out, out[1:]):
        assert upper.base_elev == pytest.approx(lower.top_elev, abs=1e-9)


def test_single_section_field_reproduces_its_section_on_the_line():
    """A one-section field still produces volume — on the line it reproduces
    the section (the collinear / single-section hole class)."""
    f = LoftField([_sec1()], domain=_dom())
    stack = f.stack_at(0.0, -10.0)
    assert [s.body_id for s in stack] == ["b-sand", "b-clay"]
    assert _thickness(stack, "b-sand") == pytest.approx(5.0)


def test_stack_is_ordered_top_to_bottom_and_gap_free():
    """The blended stack is a partition: ordered shallow→deep, contiguous."""
    f = LoftField([_sec1(), _sec2()], domain=_dom())
    stack = f.stack_at(0.0, 0.0)
    for upper, lower in zip(stack, stack[1:]):
        assert upper.top_elev >= upper.base_elev
        assert upper.base_elev == pytest.approx(lower.top_elev, abs=1e-9)


def test_stack_is_clipped_to_the_domain_interval():
    """Every entry lies within [deep_base_at, top_at]."""
    dom = _dom()
    f = LoftField([_sec1(), _sec2()], domain=dom)
    x, y = 0.0, 0.0
    top, base = dom.top_at(x, y), dom.deep_base_at(x, y)
    for e in f.stack_at(x, y):
        assert e.base_elev >= base - 1e-6
        assert e.top_elev <= top + 1e-6
