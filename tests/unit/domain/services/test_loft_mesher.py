"""Behavioural tests for ``loft_mesher`` — wedges that tile by construction.

The contract (spec §4): neighbouring wedges share faces EXACTLY by
construction, so the union of all body meshes tiles the modelled domain with
no holes, no overlaps, and no T-junctions.  These tests pin that property with
the three invariant checks (closed manifold, pairwise no-overlap, tiles the
domain) rather than inspecting triangle indices, so a regression reads as a
clear watertightness break in the spec's own vocabulary.

Comments cite the spec's terms ("wedge per body per triangle", "pinch ends at
the midline", "every body gets a real volume") — never an implementation
variable — so the tests check the behaviour, not the code shape.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.loft_field import LoftField, SectionInput
from groundmodel.domain.services.loft_mesher import build_loft_meshes
from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.section_partition import PartitionPoint, SectionRegion

from ..mesh_test_helpers import is_closed_manifold
from .loft_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
    assert_tiles_domain,
)

# ---------------------------------------------------------------------------
# Fixture helpers (mirror tests/unit/domain/services/test_loft_field.py)
# ---------------------------------------------------------------------------


def _quad(body_id, formation_id, top, base, *, kind="quad", tier=None):
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


def _sec_band(section_id, ay, *, sand_base=-5.0) -> SectionInput:
    """An E-W section at y = ``ay``: SAND 0..sand_base over CLAY sand_base..-10,
    both bodies banded (present on every section)."""
    return SectionInput(
        section_id=section_id,
        ax=-20.0,
        ay=ay,
        bx=20.0,
        by=ay,
        column_alongs=(10.0, 30.0),
        regions=(
            _quad("b-sand", "SAND", 0.0, sand_base),
            _quad("b-clay", "CLAY", sand_base, -10.0),
        ),
    )


def _sec_with_lens(section_id, ay) -> SectionInput:
    """An E-W section with a SILT lens (b-lens) between SAND and CLAY."""
    return SectionInput(
        section_id=section_id,
        ax=-20.0,
        ay=ay,
        bx=20.0,
        by=ay,
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


def _field_two_sections() -> LoftField:
    """Sand-over-clay, both banded, on two parallel sections 20 m apart."""
    return LoftField([_sec_band("s1", -10.0), _sec_band("s2", 10.0, sand_base=-3.0)], domain=_dom())


def _field_with_one_sided_lens() -> LoftField:
    """A SILT lens present only on section 1 (at y = 0); it must pinch to zero
    at the equidistance midline (y = 0)."""
    return LoftField([_sec_with_lens("s1", -10.0), _sec_band("s2", 10.0)], domain=_dom())


def _field_single_section() -> LoftField:
    """A one-section field — the collinear / single-section class that the old
    builder dropped to disk markers."""
    return LoftField([_sec_band("s1", -10.0)], domain=_dom())


def _grid_samples(domain, n: int) -> list[tuple[float, float]]:
    """Return an ``n×n`` grid of (x, y) points spanning the domain bbox."""
    xs = [p[0] for p in domain.polygon]
    ys = [p[1] for p in domain.polygon]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    out: list[tuple[float, float]] = []
    for i in range(n):
        for j in range(n):
            fx = minx + (maxx - minx) * (i + 0.5) / n
            fy = miny + (maxy - miny) * (j + 0.5) / n
            out.append((fx, fy))
    return out


# ---------------------------------------------------------------------------
# Named contract tests (plan Step 2)
# ---------------------------------------------------------------------------


def test_two_section_band_meshes_are_closed_and_tile():
    """Two bodies banded across both sections each become a single closed
    manifold, and together they tile the domain with no overlap."""
    field = _field_two_sections()
    meshes = build_loft_meshes(field, grid_spacing_m=2.0)
    assert {m.body_id for m in meshes} == {"b-sand", "b-clay"}
    for m in meshes:
        assert m.is_flagged is False
        assert_closed_manifold(m.vertices, m.triangles)
    samples = _grid_samples(field.domain, n=40)
    assert_no_overlap_sampled(meshes, samples)
    assert_tiles_domain(meshes, field, samples)


def test_one_sided_lens_mesh_ends_at_the_midline():
    """A lens present on one section but not its neighbour pinches to zero at
    the equidistance midline — its mesh ends there (no zero-thickness skin
    extends past the midline into the neighbour's half)."""
    field = _field_with_one_sided_lens()
    meshes = build_loft_meshes(field, grid_spacing_m=1.0)
    lens = next(m for m in meshes if m.body_id == "b-lens")
    assert_closed_manifold(lens.vertices, lens.triangles)
    # the two sections are at y = -10 (lens side) and y = +10; the midline is
    # y = 0, so no lens vertex may sit past it on the neighbour's side.
    assert max(v[1] for v in lens.vertices) <= 0.0 + 1e-6


def test_single_section_body_still_gets_volume():
    """Every body present in the field gets a real (non-flagged, non-empty)
    mesh — the single-section / collinear class no longer falls to markers."""
    field = _field_single_section()
    meshes = build_loft_meshes(field, grid_spacing_m=1.0)
    assert all(m.is_flagged is False for m in meshes)
    assert all(len(m.triangles) > 0 for m in meshes)


# ---------------------------------------------------------------------------
# Extra contract pins
# ---------------------------------------------------------------------------


def test_shared_body_has_no_t_junctions_on_shared_edges():
    """A body present on both sections has a closed manifold with consistent
    winding — proof there are no T-junctions on the wedge-to-wedge shared
    edges (every directed edge appears exactly once)."""
    field = _field_two_sections()
    meshes = build_loft_meshes(field, grid_spacing_m=3.0)
    for m in meshes:
        # assert_closed_manifold also asserts consistent winding (no T-junctions).
        assert_closed_manifold(m.vertices, m.triangles)
        assert is_closed_manifold(m.triangles)


def test_build_is_deterministic():
    """Identical inputs → byte-identical vertices and triangles (the bundle
    relies on a rebuild reproducing the stored solids exactly)."""
    field = _field_two_sections()
    a = build_loft_meshes(field, grid_spacing_m=2.5)
    b = build_loft_meshes(field, grid_spacing_m=2.5)
    assert [(m.body_id, m.vertices, m.triangles) for m in a] == [
        (m.body_id, m.vertices, m.triangles) for m in b
    ]


def test_lens_field_tiles_and_no_overlap():
    """With a one-sided lens the full union still tiles the domain with NO
    interior hole between bodies and NO interpenetration — the pinch closes
    cleanly into its neighbours.

    The pinch makes the litho stack base curve over the grid, so the union's
    OUTER envelope tracks the field only to the coarse-grid interpolation bound
    (``extent_tol``).  The no-interior-hole part of ``assert_tiles_domain`` stays
    strict regardless — that is the watertightness guarantee, and it is the
    property a real tiling defect would break.
    """
    field = _field_with_one_sided_lens()
    spacing = 2.0
    meshes = build_loft_meshes(field, grid_spacing_m=spacing)
    for m in meshes:
        assert_closed_manifold(m.vertices, m.triangles)
    samples = _grid_samples(field.domain, n=40)
    assert_no_overlap_sampled(meshes, samples)
    # extent_tol ≈ grid spacing — the linear-interp envelope error over a curved
    # pinch surface; the interior-hole check inside is unaffected (strict 1e-6).
    assert_tiles_domain(meshes, field, samples, extent_tol=spacing)


def test_every_field_body_appears_in_the_meshes():
    """No body present in the field is silently dropped (a dropped body is a
    hole)."""
    field = _field_with_one_sided_lens()
    meshes = build_loft_meshes(field, grid_spacing_m=2.0)
    # b-sand, b-clay band both sections; b-lens is one-sided. All three appear.
    assert {"b-sand", "b-clay", "b-lens"} <= {m.body_id for m in meshes}


@pytest.mark.parametrize("spacing", [1.0, 2.0, 4.0])
def test_tiles_at_several_grid_densities(spacing):
    """The tiling guarantee is independent of grid density: at every spacing the
    union has no interior hole and no overlap (the strict watertightness part).
    The outer envelope tracks the field to the coarse-grid interpolation bound,
    which shrinks with the spacing — so ``extent_tol`` scales with it."""
    field = _field_two_sections()
    meshes = build_loft_meshes(field, grid_spacing_m=spacing)
    samples = _grid_samples(field.domain, n=30)
    assert_no_overlap_sampled(meshes, samples)
    assert_tiles_domain(meshes, field, samples, extent_tol=spacing)
