"""Litho-3D loft-builder performance benchmarks (watertight loft, Task 10).

Run with::

    uv run pytest tests/benchmarks/bench_litho_solid_builder.py --benchmark-enable -v

:func:`~groundmodel.domain.services.loft_mesher.build_loft_meshes` is the
CPU-bound per-model surface introduced by the watertight loft builder: given a
:class:`~groundmodel.domain.services.loft_field.LoftField` (a set of 2-D section
partitions plus the model domain) it grids the map plane over the alpha hull,
densifies the section lines, Delaunay-triangulates, evaluates the blended column
stack once per node, then assembles one closed-manifold wedge mesh per body so
the union tiles the domain by construction.  Per the CLAUDE.md "when to add a
benchmark" rule (CPU-bound per-element function, lands alongside the code it
measures) it belongs here.

The function runs **once per model, on the user-clicked Build** — not per render
frame and not auto-batched.  Even the large stress case is expected to land
comfortably in Python's interactive range; the heavy lift is SciPy's C-backed
Delaunay over the map-plane node grid plus the per-node field evaluation, both
of which scale with the grid density (hull area / spacing²), not the body count.

Synthetic field design
----------------------
Each tier builds ``n_sections`` parallel E-W sections evenly spaced in Y over a
fixed corridor.  Every section carries the SAME stacked partition of
``n_bodies`` band regions (body ``k`` spans a constant depth slice at every
section), so every body is matched across all sections — the
two-nearest-blend path is exercised at every interior node and the bodies tile
by construction.  The map-plane grid spacing is the dominant cost driver, so it
is held at a realistic 5 m for all tiers; the tiers vary the corridor extent
(hull area → node count) and the body count.

Scale tiers (mirroring the retired per-body-TIN bench's small/medium/large
brackets, re-expressed in the loft's inputs):

* small  — 2 sections × 10 bodies, ~40 m corridor   (tiny fence, instantaneous).
* medium — 3 sections × 50 bodies, ~120 m corridor  (realistic project section).
* large  — 5 sections × 200 bodies, ~400 m corridor  (stress upper bound).

A ``lens`` variant adds a one-sided SILT lens (present on the first section
only) to the medium field, exercising the equidistance-midline pinch path
(``_blend_stacks`` one-sided ramp + the pinched-wedge cancellation in
:func:`build_loft_meshes`).

Baseline numbers land in CLAUDE.local.md after a stable run.
"""

from __future__ import annotations

from groundmodel.domain.services.loft_field import LoftField, SectionInput
from groundmodel.domain.services.loft_mesher import build_loft_meshes
from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.section_partition import PartitionPoint, SectionRegion

# ---------------------------------------------------------------------------
# Field geometry constants
# ---------------------------------------------------------------------------

# E-W corridor: every section runs from x = -CORRIDOR_HALF_X to +CORRIDOR_HALF_X.
_CORRIDOR_HALF_X = 20.0
# Along-positions of the two partition columns on each section line (one gap).
_COLUMN_ALONGS = (10.0, 30.0)
# Depth of each body band (m); body k spans surface-k*_LAYER_M .. surface-(k+1)*_LAYER_M.
_LAYER_M = 2.0
# Ground-surface and model-base elevations (mTAW); base sits below the deepest body.
_SURFACE_ELEV = 0.0
# Grid spacing held fixed across tiers — node count (the real cost) scales with
# the corridor extent, not this knob; 5 m matches DEFAULT_GRID_SPACING_M.
_GRID_SPACING_M = 5.0


def _quad(body_id: str, formation_id: str, top: float, base: float) -> SectionRegion:
    """A full-gap-width BAND region spanning ``[base, top]`` at every fraction.

    Parameters
    ----------
    body_id : str
        Resolver body identity (matched across sections so the blend fires).
    formation_id : str
        Lithology id (drives the fill colour).
    top, base : float
        Top and base elevations of the band (top above base, mTAW).

    Returns
    -------
    SectionRegion
        A ``quad``-kind region filling the whole gap — a banded body.
    """
    poly = [
        PartitionPoint(0.0, top),
        PartitionPoint(1.0, top),
        PartitionPoint(1.0, base),
        PartitionPoint(0.0, base),
    ]
    return SectionRegion(
        formation_id=formation_id,
        body_id=body_id,
        kind="quad",
        polygon=poly,
        overlay_tier=None,
        gap_index=0,
    )


def _stacked_regions(n_bodies: int) -> tuple[SectionRegion, ...]:
    """Build ``n_bodies`` banded regions stacked vertically from the surface.

    Body ``k`` spans ``_SURFACE_ELEV - k*_LAYER_M`` down to
    ``_SURFACE_ELEV - (k+1)*_LAYER_M`` with a lithology cycling over 8 codes —
    the same vertical stack every section carries, so each body matches across
    sections and the blend path is exercised.

    Parameters
    ----------
    n_bodies : int
        Number of stacked bodies.

    Returns
    -------
    tuple[SectionRegion, ...]
        The stacked band regions, shallow → deep.
    """
    regions: list[SectionRegion] = []
    for k in range(n_bodies):
        top = _SURFACE_ELEV - k * _LAYER_M
        base = _SURFACE_ELEV - (k + 1) * _LAYER_M
        regions.append(_quad(f"body-{k:04d}", f"form-{k % 8:02d}", top, base))
    return tuple(regions)


def _synthetic_field(
    n_sections: int,
    n_bodies: int,
    *,
    one_sided_lens: bool = False,
) -> LoftField:
    """Build a loft field of ``n_sections`` parallel E-W sections × ``n_bodies``.

    Sections are evenly spaced in Y over a corridor whose extent scales with the
    section count (so the alpha hull — and therefore the node grid the mesher
    triangulates — grows with the tier).  Every section carries the same stacked
    partition (:func:`_stacked_regions`), so every body is matched across all
    sections and the two-nearest blend fires at every interior node.

    Parameters
    ----------
    n_sections : int
        Number of parallel sections.
    n_bodies : int
        Number of stacked bodies per section.
    one_sided_lens : bool, default False
        When True, a thin SILT lens is inserted into the FIRST section only
        (splitting body 1's band) so it is present on one section but absent on
        the others — exercising the equidistance-midline pinch path.

    Returns
    -------
    LoftField
        The field ready for :func:`build_loft_meshes`.
    """
    # Spread sections over a corridor ~ (n_sections - 1) * 20 m wide in Y, with a
    # 20 m margin on each side so the domain hull comfortably encloses them.
    y_span = max(40.0, (n_sections - 1) * 20.0)
    y0 = -y_span / 2.0
    dy = y_span / max(1, n_sections - 1) if n_sections > 1 else 0.0

    sections: list[SectionInput] = []
    base_depth = -n_bodies * _LAYER_M
    for s in range(n_sections):
        ay = y0 + s * dy
        if one_sided_lens and s == 0:
            # Split body 1's band with a thin SILT lens present on this section
            # only — a one-sided pinch the blend must close at the midline.
            top1 = _SURFACE_ELEV - 1 * _LAYER_M
            base1 = _SURFACE_ELEV - 2 * _LAYER_M
            lens_top = top1 - _LAYER_M / 3.0
            lens_base = top1 - 2.0 * _LAYER_M / 3.0
            regions: list[SectionRegion] = [
                _quad("body-0000", "form-00", _SURFACE_ELEV, top1),
                _quad("body-0001", "form-01", top1, lens_top),
                SectionRegion(
                    formation_id="SILT",
                    body_id="body-lens",
                    kind="lens",
                    polygon=[
                        PartitionPoint(0.0, lens_top),
                        PartitionPoint(1.0, lens_top),
                        PartitionPoint(1.0, lens_base),
                        PartitionPoint(0.0, lens_base),
                    ],
                    overlay_tier="lens",
                    gap_index=0,
                ),
                _quad("body-0001b", "form-01", lens_base, base1),
            ]
            for k in range(2, n_bodies):
                top = _SURFACE_ELEV - k * _LAYER_M
                base = _SURFACE_ELEV - (k + 1) * _LAYER_M
                regions.append(_quad(f"body-{k:04d}", f"form-{k % 8:02d}", top, base))
            section_regions: tuple[SectionRegion, ...] = tuple(regions)
        else:
            section_regions = _stacked_regions(n_bodies)
        sections.append(
            SectionInput(
                section_id=f"sec-{s}",
                ax=-_CORRIDOR_HALF_X,
                ay=ay,
                bx=_CORRIDOR_HALF_X,
                by=ay,
                column_alongs=_COLUMN_ALONGS,
                regions=section_regions,
            )
        )

    # Domain tests bracket the corridor (corners + centre) so the alpha hull
    # covers every section; base sits below the deepest body.
    margin = 5.0
    tests = [
        DomainTest("t-sw", -_CORRIDOR_HALF_X - margin, y0 - margin, _SURFACE_ELEV, base_depth),
        DomainTest("t-se", _CORRIDOR_HALF_X + margin, y0 - margin, _SURFACE_ELEV, base_depth),
        DomainTest(
            "t-ne", _CORRIDOR_HALF_X + margin, y0 + y_span + margin, _SURFACE_ELEV, base_depth
        ),
        DomainTest(
            "t-nw", -_CORRIDOR_HALF_X - margin, y0 + y_span + margin, _SURFACE_ELEV, base_depth
        ),
        DomainTest("t-c", 0.0, y0 + y_span / 2.0, _SURFACE_ELEV, base_depth),
    ]
    return LoftField(sections, domain=build_model_domain(tests))


def _sanity_check(meshes: list, n_bodies: int) -> None:
    """Assert the build produced real (non-flagged, non-empty) body meshes.

    The loft builder never flags — every body gets a real volume — so a flagged
    or empty mesh means the synthetic field degenerated and the benchmark is
    measuring the wrong (trivial) path.

    Parameters
    ----------
    meshes : list
        Output of :func:`build_loft_meshes`.
    n_bodies : int
        Number of distinct stacked bodies (a lower bound on the mesh count).
    """
    assert meshes, "build produced no meshes — the synthetic field degenerated"
    assert all(not m.is_flagged for m in meshes), "loft meshes must never be flagged"
    assert all(m.triangles for m in meshes), "every body mesh must have triangles"
    # At least one mesh per stacked body should survive (band fillers may add more).
    assert len(meshes) >= 1


# ---------------------------------------------------------------------------
# Small — 2 sections × 10 bodies
# ---------------------------------------------------------------------------


def test_bench_build_loft_meshes_small(benchmark) -> None:
    """Small fence: 2 sections × 10 bodies (~40 m corridor).

    A short two-section corridor with a handful of formations — a quick
    on-demand Build that should feel instantaneous.
    """
    n_sections, n_bodies = 2, 10
    field = _synthetic_field(n_sections, n_bodies)
    meshes = benchmark(build_loft_meshes, field, _GRID_SPACING_M)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Medium — 3 sections × 50 bodies
# ---------------------------------------------------------------------------


def test_bench_build_loft_meshes_medium(benchmark) -> None:
    """Medium fence: 3 sections × 50 bodies (~120 m corridor).

    A realistic project: three cross-sections, 50 stacked formation units.
    The common expected case.
    """
    n_sections, n_bodies = 3, 50
    field = _synthetic_field(n_sections, n_bodies)
    meshes = benchmark(build_loft_meshes, field, _GRID_SPACING_M)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Large — 5 sections × 200 bodies
# ---------------------------------------------------------------------------


def test_bench_build_loft_meshes_large(benchmark) -> None:
    """Large fence: 5 sections × 200 bodies (~400 m corridor).

    Stress upper bound — five cross-sections over a wide corridor with 200
    stacked units is not realistic geology but proves the loft builder scales
    gracefully.  Runs once per user-clicked Build, not per render frame.
    """
    n_sections, n_bodies = 5, 200
    field = _synthetic_field(n_sections, n_bodies)
    meshes = benchmark(build_loft_meshes, field, _GRID_SPACING_M)
    _sanity_check(meshes, n_bodies)


# ---------------------------------------------------------------------------
# Lens — 3 sections × 50 bodies + a one-sided SILT lens (midline-pinch path)
# ---------------------------------------------------------------------------


def test_bench_build_loft_meshes_with_lens(benchmark) -> None:
    """Medium fence with a one-sided lens: 3 sections × 50 bodies + a SILT lens.

    The lens is present on the first section only, so it pinches to zero
    thickness at the equidistance midline — exercising the one-sided blend ramp
    in :func:`~groundmodel.domain.services.loft_field.LoftField` and the
    pinched-wedge cancellation in :func:`build_loft_meshes`.  This case exposes
    any overhead the midline-pinch path adds over the plain banded medium case.
    """
    n_sections, n_bodies = 3, 50
    field = _synthetic_field(n_sections, n_bodies, one_sided_lens=True)
    meshes = benchmark(build_loft_meshes, field, _GRID_SPACING_M)
    _sanity_check(meshes, n_bodies)
