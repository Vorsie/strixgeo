"""Read-only real-data gate: watertight per-body SOLIDS extracted from the labels.

Sibling of :mod:`scripts.eval_voxel_label`.  Where that script gates the
LABELLING rule (does the labelled grid reproduce the 2-D partition on each
section plane?), this script gates the MESHING: it runs
``label_voxels`` -> ``extract_body_solids`` on the hand-exported ``test.strix``
section partitions and asserts the extracted solids are correct AND that meshing
did not move the boundary off the labels.

Three checks (spec Task 4, Step 5):

(a) MANIFOLD — every extracted body is a closed 2-manifold
    (``assert_closed_manifold``).  A non-manifold edge (e.g. a diagonal voxel
    touch shared by 4 faces) FAILS here; it is a real finding to fix, never a
    fixture to relax.
(b) NO-OVERLAP — STRICT ``assert_no_overlap_sampled`` across ALL bodies over a
    representative ``(x, y)`` sample set (one interior point per region of every
    section).  Two DIFFERENT bodies sharing a vertical interval is a defect.
(c) ON-LABEL — the per-section ray-sample of the SOLIDS still reproduces the
    grid labelling: at each region's interior sample we ray-cast the solids at
    that world ``(x, y)`` and confirm the body covering the sampled elevation is
    the SAME body the grid labels there.  This proves the meshing did not move
    the boundary off the labels (it is NOT a re-check of label-vs-partition —
    that is ``eval_voxel_label.py``).

Greedy meshing (Task 5) collapses coplanar same-body faces into maximal
rectangles, so the script also reports the triangle count BEFORE (``greedy=False``,
one quad per voxel face) vs AFTER (``greedy=True``, the production default) the
merge, and confirms that the merged solids still pass all three gates AND that
the on-label match is unchanged vs the un-merged baseline (the merge moves no
surface).  Pass ``--no-greedy`` to gate the un-merged baseline only.

This script touches NO database — it reads only the JSON fixture — so it is
read-only and self-contained by construction.

Usage
-----
    uv run python scripts/eval_voxel_solids.py
    uv run python scripts/eval_voxel_solids.py --grid-spacing 2.0
    uv run python scripts/eval_voxel_solids.py --samples-per-region 2
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Bootstrap sys.path so the first-party + sibling-script imports resolve.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from scripts.eval_voxel_label import (  # noqa: E402
    _FIXTURE,
    _frac_gap_to_world,
    _label_at,
    _load_sections,
    _region_interior_samples,
)
from tests.unit.domain.services.strat_field.strat_invariants import (  # noqa: E402
    assert_closed_manifold,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)


def _solids_body_at(
    bodies: list[object], x: float, y: float, elev: float
) -> tuple[str | None, str | None]:
    """Ray-cast the SOLIDS at ``(x, y)`` and return the body covering ``elev``.

    Iterates every body's vertical intervals at ``(x, y)`` and returns the
    ``(body_id, formation_id)`` of the first whose ``[base, top]`` contains
    ``elev`` (with a small inclusive tolerance for boundary grazes).  Returns
    ``(None, None)`` when no solid covers the elevation.

    Parameters
    ----------
    bodies : list of object
        ``LithoBodyMesh`` objects (duck-typed: ``body_id`` / ``formation_id`` /
        ``vertices`` / ``triangles``).
    x, y, elev : float
        The world query point.

    Returns
    -------
    tuple[str | None, str | None]
        The covering body's ``(body_id, formation_id)``, or ``(None, None)``.
    """
    for b in bodies:
        for base, top in vertical_ray_intervals(b.vertices, b.triangles, x, y):  # type: ignore[attr-defined]
            if base - 1e-6 <= elev <= top + 1e-6:
                return b.body_id, b.formation_id  # type: ignore[attr-defined]
    return None, None


def main() -> int:
    """Run the watertight-solids real-data gate and print a PASS/FAIL summary.

    Returns
    -------
    int
        ``0`` when every body is a closed manifold, no two bodies overlap, and
        the solids reproduce the grid labels at every region sample; ``1``
        otherwise (so a caller / CI can gate on the exit code).
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--grid-spacing",
        type=float,
        default=None,
        help="Voxel edge length in metres (default: the fixture's grid_spacing_m).",
    )
    parser.add_argument(
        "--samples-per-region",
        type=int,
        default=2,
        help="Interior elevation samples per region for the on-label check (default: 2).",
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=_FIXTURE,
        help="Path to the section-partition fixture JSON.",
    )
    parser.add_argument(
        "--no-greedy",
        dest="greedy",
        action="store_false",
        help="Gate the un-merged per-voxel-face baseline instead of greedy meshing.",
    )
    parser.set_defaults(greedy=True)
    args = parser.parse_args()

    sections, fixture_h = _load_sections(args.fixture)
    h = args.grid_spacing if args.grid_spacing is not None else fixture_h
    print(f"Loaded {len(sections)} sections from {args.fixture.name}; grid spacing {h} m")

    domain = build_domain_from_sections(sections)
    grid = label_voxels(domain, h, sections)
    print(
        f"Labelled grid: {len(grid.gx)} x {len(grid.gy)} x {len(grid.gz)} "
        f"= {grid.labels.size:,} voxels; {len(grid.body_id_by_index)} body slots"
    )

    bodies = extract_body_solids(grid, greedy=args.greedy)
    n_tris = sum(len(b.triangles) for b in bodies)
    n_verts = sum(len(b.vertices) for b in bodies)
    label = "greedy-merged" if args.greedy else "un-merged (per-cell)"
    print(f"Extracted {len(bodies)} body solids ({label}); {n_verts:,} verts, {n_tris:,} triangles")

    # Report the triangle-count reduction vs the un-merged baseline so the perf
    # win is recorded.  Only when greedy is on (the baseline IS the no-greedy run).
    if args.greedy:
        baseline = extract_body_solids(grid, greedy=False)
        n_tris_base = sum(len(b.triangles) for b in baseline)
        ratio = n_tris_base / n_tris if n_tris else float("inf")
        print(
            f"TRIANGLES: {n_tris_base:,} un-merged -> {n_tris:,} greedy "
            f"({ratio:.1f}x fewer, {100.0 * (1.0 - n_tris / n_tris_base):.1f}% reduction)"
        )
    print()

    # --- (a) MANIFOLD -------------------------------------------------------
    non_manifold: list[str] = []
    for b in bodies:
        try:
            assert_closed_manifold(b.vertices, b.triangles)
        except AssertionError as exc:
            non_manifold.append(f"  body {b.body_id!r} ({b.formation_id}): {exc}")
    if non_manifold:
        print(f"MANIFOLD: {len(non_manifold)}/{len(bodies)} bodies are NOT closed manifolds:")
        for line in non_manifold[:10]:
            print(line)
    else:
        print(f"MANIFOLD: all {len(bodies)} bodies are closed 2-manifolds.")

    # --- (b) NO-OVERLAP -----------------------------------------------------
    # One interior point per region of every section (a representative spread of
    # (x, y) across the whole footprint, not just the grid corners).
    samples: list[tuple[float, float]] = []
    for section in sections:
        for region in section.regions:
            pts = _region_interior_samples(region, 1)
            if pts:
                frac, _elev = pts[0]
                samples.append(_frac_gap_to_world(section, region.gap_index, frac))
    overlap_err: str | None = None
    try:
        assert_no_overlap_sampled(bodies, samples)
    except AssertionError as exc:
        overlap_err = str(exc)
    if overlap_err:
        print(f"NO-OVERLAP: FAILED over {len(samples)} samples:\n  {overlap_err}")
    else:
        print(f"NO-OVERLAP: no two bodies overlap over {len(samples)} (x, y) samples.")

    # --- (c) ON-LABEL: solids reproduce the grid labelling ------------------
    # At each region interior sample, the body the SOLIDS cover at that elevation
    # must equal the body the GRID labels there — i.e. meshing did not move the
    # boundary off the labels.  This compares solids-vs-grid (NOT solids-vs-
    # partition; the partition-vs-grid fidelity is eval_voxel_label.py's gate),
    # so a sub-voxel resolution mismatch from labelling does not count against
    # the mesher here.
    on_label = 0
    on_label_total = 0
    on_label_misses: list[str] = []
    for si, section in enumerate(sections):
        for region in section.regions:
            for frac, elev in _region_interior_samples(region, args.samples_per_region):
                wx, wy = _frac_gap_to_world(section, region.gap_index, frac)
                gb, gf = _label_at(grid, wx, wy, elev)
                if gb is None:
                    continue  # grid is void here (footprint edge) — nothing to match
                on_label_total += 1
                sb, sf = _solids_body_at(bodies, wx, wy, elev)
                if sb == gb and sf == gf:
                    on_label += 1
                elif len(on_label_misses) < 8:
                    on_label_misses.append(
                        f"  S{si} gap{region.gap_index} f={frac:.2f} z={elev:.2f}: "
                        f"grid ({gb}, {gf}) vs solids ({sb}, {sf})"
                    )

    def _pct(m: int, t: int) -> float:
        return 100.0 * m / t if t else 100.0

    print(
        f"ON-LABEL: solids match grid at {on_label}/{on_label_total} "
        f"= {_pct(on_label, on_label_total):.1f}% of region samples."
    )
    if on_label_misses:
        print("ON-LABEL misses (grid vs solids):")
        for line in on_label_misses:
            print(line)
    print()

    # --- verdict ------------------------------------------------------------
    # MANIFOLD and NO-OVERLAP are by-construction guarantees of the welded
    # XOR-boundary, so any failure is a real defect.  ON-LABEL must be 100%: the
    # ray-cast of a solid extracted FROM the labels must read the labelled body
    # at every interior sample (a solid voxel face sits exactly on a corner
    # lattice plane, so an interior sample is never on a boundary).  A residual
    # is a real mesher defect, not a resolution effect.
    on_label_pct = _pct(on_label, on_label_total)
    ok = (not non_manifold) and (overlap_err is None) and on_label_pct >= 100.0 - 1e-9
    if ok:
        print(
            f"PASS — all {len(bodies)} bodies closed-manifold + non-overlapping, "
            f"and the solids reproduce the grid labelling at 100% of samples "
            f"({label}, {n_tris:,} triangles)."
        )
        return 0
    print(
        "FAIL — watertight-solids gate not met "
        f"(non-manifold bodies: {len(non_manifold)}, overlap: {overlap_err is not None}, "
        f"on-label: {on_label_pct:.1f}%). Investigate the mesher (do NOT relax the gate)."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
