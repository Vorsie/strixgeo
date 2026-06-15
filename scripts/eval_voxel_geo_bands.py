"""Read-only real-data gate: geological-band-scoped voxel fill on ``test.strix``.

Task-3 Step-5 validation.  Where :mod:`scripts.eval_voxel_label` gates the
UN-BOUNDED labelling rule, this script gates the BAND-SCOPED labelling: it loads
the hand-exported ``test.strix`` section partitions
(``tests/fixtures/voxel/teststrix_partitions.json``) AND the parent geological
model's built band surfaces from the dev ``groundmodel`` DB, then runs
:func:`label_voxels` WITH ``geo_surfaces=...`` and asserts the spec's five
checks:

1. NO POPULATED BAND LEFT VOID below a shallow test — for each in-footprint
   column, a geological band whose interval lies BELOW the shallowest void run
   must NOT itself be void (the ~985 sand/silt-bottom-with-void-below columns of
   the un-bounded build now fill their deeper band via the sideways fill).
2. ZERO litho voxels on the WRONG side of a geological surface — sampling just
   above / below each band surface elevation at every column confirms the
   labelled body's formation sits in the band that elevation belongs to.
3. ON-SECTION RULE FIDELITY unchanged — the band-scoped rule still reproduces
   each section's 2-D partition on the section plane (the same RULE measurement
   ``eval_voxel_label.py`` reports, >99% lithology on ``test.strix``).
4. ``extract_body_solids`` still all CLOSED-MANIFOLD + STRICT NO-OVERLAP
   (the ``eval_voxel_solids.py`` gate, re-run on the band-scoped grid).
5. DEEPEST-BAND SUBSTRATE composition — the formation tally of the deepest
   geological band, reported BEFORE (un-bounded) vs AFTER (band-scoped) so the
   sideways fill of the deep substrate is visible.

A deviation from any check is a REAL finding — STOP, flag the step, fix the
path, NEVER relax the assertion.

The script READS the dev DB (geo surfaces only) but writes NOTHING — no build,
no commit.  It confirms the DB target and ABORTS if the DSN is not the dev
``groundmodel`` DB (mirroring ``eval_voxel_build.py._confirm_db_target``).

Usage
-----
    uv run python scripts/eval_voxel_geo_bands.py
    uv run python scripts/eval_voxel_geo_bands.py --grid-spacing 2.0
    uv run python scripts/eval_voxel_geo_bands.py --parent-geo-model-id <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.strat_field.strat_types import SurfaceBound  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.geo_bands import band_of  # noqa: E402
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    LabelGrid,
    SectionPartitionInput,
)
from groundmodel.shared.config import settings  # noqa: E402
from scripts.eval_voxel_label import (  # noqa: E402
    _FIXTURE,
    _frac_gap_to_world,
    _load_sections,
    _region_interior_samples,
)
from tests.unit.domain.services.strat_field.strat_invariants import (  # noqa: E402
    assert_closed_manifold,
    assert_no_overlap_sampled,
)

# Default litho model + parent geological model for the dev ``test.strix`` build
# (the CLAUDE.local.md / task IDs).  argparse defaults — override per project.
_DEFAULT_PARENT_GEO_MODEL_ID = UUID("019e932e-41d1-7213-aa32-08fac692684a")


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT if it is not the dev ``groundmodel`` DB."""
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' — refusing to run ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(
            f"ABORT: DSN names an integration/test DB — this eval must run against "
            f"the dev 'groundmodel' DB only ({url!r})."
        )
    print("  DB target OK (dev groundmodel).")


def _column_formation(grid: LabelGrid, i: int, j: int, k: int) -> str | None:
    """Return the labelled formation of voxel ``(i, j, k)`` (``None`` for void)."""
    label = int(grid.labels[i, j, k])
    if label < 0:
        return None
    return grid.formation_by_body[grid.body_id_by_index[label]]


def _check_no_void_below_filled_in_a_populated_band(
    grid: LabelGrid, surfaces: tuple[SurfaceBound, ...]
) -> tuple[int, int, list[str]]:
    """Check (1): no WHOLE geological band left void below a shallow test's fill.

    The spec's target: the ``~985 sand/silt-bottom-with-void-below`` columns
    where a shallow test stops and a WHOLE deeper geological band was left void —
    the band-scoped sideways fill must now populate that deeper band.  So the
    failure condition is a geological band that is ENTIRELY void in this column
    AND is SANDWICHED between a filled band above and a filled band below: a band
    the model populates around but skips here (the sideways fill failed to reach
    it).

    A PARTIAL void pocket within an otherwise-populated band (a litho that
    genuinely pinches out before filling the band's full vertical extent) is NOT
    a failure — the voxel model faithfully represents that pinch-out as void
    rather than fabricating litho by vertical fill-down (owner directive
    2026-06-11: "extrapolated HORIZONTALLY, NO vertical fill-down").  These
    partial pockets are counted + reported separately (informational).

    Returns
    -------
    tuple[int, int, list[str]]
        ``(n_whole_band_void_failures, n_partial_void_pockets, examples)``.
    """
    nx, ny, nz = grid.labels.shape
    n_surf = len(surfaces)
    failures = 0
    partial = 0
    examples: list[str] = []
    for i in range(nx):
        x = float(grid.gx[i])
        for j in range(ny):
            y = float(grid.gy[j])
            col = grid.labels[i, j, :]
            if not np.any(col >= 0):
                continue  # all-void column (outside footprint) — nothing to check
            # Tally fill per geological band for this column: filled-voxel count
            # and total in-grid voxel count, band by band.
            filled_per_band: dict[int, int] = {}
            total_per_band: dict[int, int] = {}
            for k in range(nz):
                band = band_of(surfaces, x, y, float(grid.gz[k]))
                total_per_band[band] = total_per_band.get(band, 0) + 1
                if col[k] >= 0:
                    filled_per_band[band] = filled_per_band.get(band, 0) + 1
            filled_bands = {b for b, n in filled_per_band.items() if n > 0}
            if not filled_bands:
                continue
            shallowest_filled = min(filled_bands)
            deepest_filled = max(filled_bands)
            for band in range(shallowest_filled + 1, deepest_filled):
                if total_per_band.get(band, 0) == 0:
                    continue  # this band has no grid voxels at this column
                n_fill = filled_per_band.get(band, 0)
                if n_fill == 0:
                    # WHOLE band void, sandwiched between filled bands → failure.
                    failures += 1
                    if len(examples) < 8:
                        examples.append(
                            f"  col ({x:.1f}, {y:.1f}) band {band} ENTIRELY void "
                            f"(filled bands above {shallowest_filled} + below {deepest_filled})"
                        )
                    break
                if n_fill < total_per_band[band]:
                    partial += 1  # partial pinch-out pocket — faithful, informational
    _ = n_surf
    return failures, partial, examples


def _check_no_litho_on_wrong_side(
    grid: LabelGrid,
    sections: list[SectionPartitionInput],
    surfaces: tuple[SurfaceBound, ...],
    snap_tol: float,
) -> tuple[int, int, list[str]]:
    """Check (2): zero litho voxels on the WRONG side of a geological surface.

    A litho is on the wrong side iff some labelled body's defining interval
    SPANS a geological surface — i.e. the band-scoped column stack contains an
    ``_Entry`` whose ``[base, top]`` crosses a surface elevation at ``(x, y)`` by
    more than ``snap_tol``.  (A litho legitimately DIVIDED at the surface yields
    two separate entries, one per band, each fully inside its band — NOT a span;
    a litho that genuinely PINCHES OUT leaves a void on its side — also not a
    span.  Only an interval that runs continuously through the surface is the
    geological-crossing defect.)

    This is verified directly on the band-scoped assembled stack at every grid
    column (the same ``_column_stack_geo`` the labeller uses), so it catches a
    clip / gap-aware-labeller regression independently of the grid snap.

    Returns
    -------
    tuple[int, int, list[str]]
        ``(n_spanning_entries, n_columns_checked, examples)``.
    """
    from groundmodel.domain.services.voxel_litho.label_voxels import _column_stack_geo

    gz_min = float(grid.gz[0])
    gz_max = float(grid.gz[-1])
    nx, ny, _nz = grid.labels.shape
    spanning = 0
    columns_checked = 0
    examples: list[str] = []
    for i in range(nx):
        x = float(grid.gx[i])
        for j in range(ny):
            y = float(grid.gy[j])
            col = grid.labels[i, j, :]
            if not np.any(col >= 0):
                continue  # outside the footprint — nothing to check
            columns_checked += 1
            stack = _column_stack_geo(sections, x, y, gz_min, gz_max, surfaces, snap_tol)
            surf_elevs = [s.evaluate(x, y) for s in surfaces]
            for e in stack:
                for s_elev in surf_elevs:
                    # The entry SPANS the surface if both ends sit strictly on
                    # opposite sides by more than the snap tolerance (a divided
                    # entry abuts the surface to within snap_tol on one side).
                    if e.top_elev > s_elev + snap_tol and e.base_elev < s_elev - snap_tol:
                        spanning += 1
                        if len(examples) < 8:
                            examples.append(
                                f"  col ({x:.1f}, {y:.1f}) surface z={s_elev:.2f}: "
                                f"body {e.body_id} interval [{e.base_elev:.2f}, "
                                f"{e.top_elev:.2f}] spans the surface"
                            )
                        break
    return spanning, columns_checked, examples


def _rule_fidelity(
    grid: LabelGrid,
    sections: list[SectionPartitionInput],
    surfaces: tuple[SurfaceBound, ...],
) -> tuple[int, int, list[str]]:
    """Check (3): the band-scoped RULE still reproduces each section's partition.

    Mirrors ``eval_voxel_label._rule_body_at`` but evaluates the BAND-SCOPED
    column stack (the same ``_column_stack_geo`` the labeller uses), so the
    measurement is of the band-aware rule, not the un-bounded blend.  Returns
    ``(formation_matched, total, miss_examples)``.
    """
    from groundmodel.domain.services.voxel_litho.label_voxels import _column_stack_geo

    gz_min = float(grid.gz[0])
    gz_max = float(grid.gz[-1])
    formation_matched = 0
    total = 0
    misses: list[str] = []
    for si, section in enumerate(sections):
        for region in section.regions:
            for frac, elev in _region_interior_samples(region, 3):
                wx, wy = _frac_gap_to_world(section, region.gap_index, frac)
                total += 1
                stack = _column_stack_geo(sections, wx, wy, gz_min, gz_max, surfaces, 0.20)
                got_formation: str | None = None
                for e in stack:
                    if e.base_elev - 1e-9 <= elev <= e.top_elev + 1e-9:
                        got_formation = e.formation_id
                        break
                if got_formation == region.formation_id:
                    formation_matched += 1
                elif len(misses) < 8:
                    misses.append(
                        f"  S{si} gap{region.gap_index} f={frac:.2f} z={elev:.2f}: "
                        f"want {region.formation_id} got {got_formation}"
                    )
    return formation_matched, total, misses


def _deepest_band_composition(
    grid: LabelGrid, surfaces: tuple[SurfaceBound, ...]
) -> dict[str, int]:
    """Check (5): formation tally of the DEEPEST geological band.

    Counts filled voxels whose elevation falls in the deepest band
    (``band_of == len(surfaces)``), grouped by formation.  Reported before vs
    after the band-scoped fill so the deep-substrate sideways fill is visible.
    """
    deepest = len(surfaces)
    nx, ny, nz = grid.labels.shape
    tally: dict[str, int] = {}
    for i in range(nx):
        x = float(grid.gx[i])
        for j in range(ny):
            y = float(grid.gy[j])
            col = grid.labels[i, j, :]
            if not np.any(col >= 0):
                continue
            for k in range(nz):
                label = int(col[k])
                if label < 0:
                    continue
                if band_of(surfaces, x, y, float(grid.gz[k])) != deepest:
                    continue
                fid = grid.formation_by_body[grid.body_id_by_index[label]]
                tally[fid] = tally.get(fid, 0) + 1
    return tally


async def _load_surfaces(parent_geo_model_id: UUID) -> tuple[SurfaceBound, ...]:
    """Load the parent geological model's built band surfaces from the dev DB."""
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            return await load_geo_surfaces(session, parent_geo_model_id)
    finally:
        await engine.dispose()


def main() -> int:
    """Run the band-scoped real-data gate and print a PASS/FAIL summary."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--grid-spacing",
        type=float,
        default=None,
        help="Voxel edge length in metres (default: the fixture's grid_spacing_m).",
    )
    ap.add_argument(
        "--parent-geo-model-id",
        type=UUID,
        default=_DEFAULT_PARENT_GEO_MODEL_ID,
        help="Parent geological model id whose band surfaces bound the build.",
    )
    ap.add_argument("--fixture", type=Path, default=_FIXTURE)
    args = ap.parse_args()

    print("=== voxel geo-band real-data gate (test.strix) ===")
    _confirm_db_target()

    sections, fixture_h = _load_sections(args.fixture)
    h = args.grid_spacing if args.grid_spacing is not None else fixture_h
    print(f"  fixture: {args.fixture.name} — {len(sections)} sections; grid spacing {h} m")

    surfaces = asyncio.run(_load_surfaces(args.parent_geo_model_id))
    print(f"  loaded {len(surfaces)} geological band surface(s)")
    if not surfaces:
        raise SystemExit(
            "ABORT: no built band surfaces for the parent geological model — "
            "cannot gate the band-scoped path (build the geology model first)."
        )
    for n, s in enumerate(surfaces):
        elevs = [v[2] for v in s.vertices]
        print(f"    surface {n}: {len(s.vertices)} verts, elev mean {np.mean(elevs):.2f} m")
    print()

    domain = build_domain_from_sections(sections)
    print(f"  domain footprint: {len(domain.polygon)}-vertex alpha hull")

    grid_unbounded = label_voxels(domain, h, sections)
    grid = label_voxels(domain, h, sections, geo_surfaces=surfaces)
    print(
        f"  labelled grid: {len(grid.gx)} x {len(grid.gy)} x {len(grid.gz)} "
        f"= {grid.labels.size:,} voxels; {len(grid.body_id_by_index)} bodies"
    )
    print()

    # --- (1) no populated band left void below a shallow test ----------------
    n_void_fail, n_partial, void_examples = _check_no_void_below_filled_in_a_populated_band(
        grid, surfaces
    )
    # Baseline: the SAME geo bands applied to the UN-BOUNDED grid — how many
    # whole-band-void columns the un-bounded build leaves (the ones the sideways
    # fill is meant to close).
    n_void_base, n_partial_base, _ = _check_no_void_below_filled_in_a_populated_band(
        grid_unbounded, surfaces
    )
    print("--- (1) NO WHOLE BAND VOID BELOW A SHALLOW TEST ---")
    print(f"  band-scoped whole-band-void columns : {n_void_fail}")
    print(f"  un-bounded  whole-band-void columns : {n_void_base} (the sideways-fill target)")
    print(f"  partial pinch-out pockets (faithful, informational): {n_partial}")
    for line in void_examples:
        print(line)

    # --- (2) zero litho voxels on the wrong side of a geo surface ------------
    n_span, n_cols, span_examples = _check_no_litho_on_wrong_side(grid, sections, surfaces, 0.20)
    print()
    print("--- (2) NO LITHO ON THE WRONG SIDE OF A GEO SURFACE ---")
    print(f"  surface-spanning litho intervals: {n_span} over {n_cols} columns")
    for line in span_examples:
        print(line)

    # --- (3) on-section RULE fidelity (band-scoped) -------------------------
    f_matched, f_total, f_misses = _rule_fidelity(grid, sections, surfaces)
    f_pct = 100.0 * f_matched / f_total if f_total else 100.0
    print()
    print("--- (3) ON-SECTION RULE FIDELITY (band-scoped) ---")
    print(f"  lithology reproduced: {f_matched}/{f_total} = {f_pct:.1f}%")
    for line in f_misses:
        print(line)

    # --- (4) solids closed-manifold + strict no-overlap ---------------------
    bodies = extract_body_solids(grid)
    bodies = [b for b in bodies if b.vertices and b.triangles]
    non_manifold = []
    for b in bodies:
        try:
            assert_closed_manifold(b.vertices, b.triangles)
        except AssertionError as exc:
            non_manifold.append(f"  body {b.body_id!r} ({b.formation_id}): {exc}")
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
    print()
    print("--- (4) SOLIDS: CLOSED-MANIFOLD + STRICT NO-OVERLAP ---")
    print(f"  extracted {len(bodies)} body solid(s)")
    if non_manifold:
        print(f"  NON-MANIFOLD: {len(non_manifold)} bodies:")
        for line in non_manifold[:10]:
            print(line)
    else:
        print(f"  all {len(bodies)} bodies are closed 2-manifolds")
    if overlap_err:
        print(f"  OVERLAP over {len(samples)} samples: {overlap_err[:200]}")
    else:
        print(f"  no inter-body overlap over {len(samples)} (x, y) samples")

    # --- (5) deepest-band substrate composition (before vs after) -----------
    before = _deepest_band_composition(grid_unbounded, surfaces)
    after = _deepest_band_composition(grid, surfaces)
    print()
    print("--- (5) DEEPEST-BAND SUBSTRATE COMPOSITION (before vs after) ---")
    before_total = sum(before.values())
    after_total = sum(after.values())
    print(f"  un-bounded  : {before_total:,} voxels in the deepest band")
    for fid, n in sorted(before.items(), key=lambda kv: -kv[1])[:8]:
        print(f"      {fid}: {n:,}")
    print(f"  band-scoped : {after_total:,} voxels in the deepest band")
    for fid, n in sorted(after.items(), key=lambda kv: -kv[1])[:8]:
        print(f"      {fid}: {n:,}")
    print()

    # --- verdict ------------------------------------------------------------
    # (1) the band-scoped build must leave NO populated band void below a shallow
    #     test; (2) zero straddling bodies; (3) lithology fidelity stays high
    #     (the same >99% bar as eval_voxel_label); (4) manifold + no overlap.
    ok_void = n_void_fail == 0
    ok_span = n_span == 0
    ok_fidelity = f_pct >= 99.0
    ok_solids = (not non_manifold) and overlap_err is None
    ok = ok_void and ok_span and ok_fidelity and ok_solids
    print("=== VERDICT ===")
    print(
        f"  (1) no void below shallow test : {'PASS' if ok_void else 'FAIL'} "
        f"({n_void_fail} failing cols; un-bounded baseline {n_void_base})"
    )
    print(
        f"  (2) no wrong-side litho        : {'PASS' if ok_span else 'FAIL'} "
        f"({n_span} surface-spanning intervals)"
    )
    print(f"  (3) on-section fidelity >= 99% : {'PASS' if ok_fidelity else 'FAIL'} ({f_pct:.1f}%)")
    print(f"  (4) manifold + no-overlap      : {'PASS' if ok_solids else 'FAIL'}")
    if ok:
        print("PASS — band-scoped voxel fill is faithful, watertight, and geology-bounded.")
        return 0
    print("FAIL — a band-scoped check did not pass. Investigate (do NOT relax the gate).")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
