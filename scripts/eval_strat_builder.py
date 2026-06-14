"""Real-data evaluation harness for the implicit-stratigraphic 3-D litho builder.

The make-or-break check on the strat builder (spec
``2026-06-13-implicit-stratigraphic-3d-builder-design.md``): rebuild ONE real
``test.strix`` lithostratigraphic model and measure whether the field-based
builder produces a coherent, watertight, NON-overlapping 3-D model.  The old loft
mesher produced ~50 metre-scale section-column overlaps on this same data; the
strat target is ~0.

What this script reports (raw numbers — the caller interprets)
--------------------------------------------------------------
1. **DB target confirmation** — prints ``settings.database_url`` and ABORTS if it
   is not the dev ``groundmodel`` DB (and is not an ``_integration`` / ``_test``
   sibling).  Safety first — this writes ``litho_body_solid`` rows + one
   ``view_state`` knob.
2. **Stage-1 coherence** — assembles the strat inputs and calls
   ``build_stratigraphic_order``: does the 102-instance order topo-sort, or does
   it hit a directed cycle (``NonConformableError`` → the v1 fault/unconformity
   limitation)?  Horizon count on success; the offending instances on failure.
3. **Field bounded** — fits the field and samples ``F`` on a coarse dense grid,
   reporting ``max(abs(F))`` against the iso-value range (the Task-8.5
   normalization fix should keep it ~iso-range, NOT ~190k).
4. **Build + persist** — runs ``RecomputeLithoSolids.execute(force=True)`` and
   times it.  Sets ``strat_grid_spacing_m`` (default 2.0 m ≈ 94k cells) so the
   eval is tractable.
5. **Section-column overlap diagnostic (THE HEADLINE)** — reuses the Task-7
   ``vertical_ray_intervals`` / ``_intervals_overlap`` helpers to ray-sample the
   persisted body solids at every authored column (x, y) and count interior
   overlaps between DIFFERENT bodies, plus coverage gaps.  The loft had 50; the
   strat target is ~0.

Usage
-----
    uv run python scripts/eval_strat_builder.py
    uv run python scripts/eval_strat_builder.py --model-id <uuid>
    uv run python scripts/eval_strat_builder.py --grid-spacing 2.0
    uv run python scripts/eval_strat_builder.py --also-time-1m

The ``view_state`` grid-spacing write is a real (intended) mutation of the dev DB
so a subsequent on-click Build uses the same spacing; everything else only
rewrites the one model's ``litho_body_solid`` rows (that IS the feature).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import traceback
from collections import defaultdict
from pathlib import Path
from statistics import median
from uuid import UUID

# The Task-7 invariant helpers live under ``tests/`` (the single home for the
# ray-cast + overlap math).  ``tests`` is a package but the repo root is not on
# sys.path when this script runs as a module, so prepend it before importing
# anything below.  The path bootstrap must run before the first-party imports,
# so they carry ``noqa: E402`` (import-not-at-top) — expected for a bootstrap.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from groundmodel.application.assemble_strat_inputs import AssembleStratInputs  # noqa: E402
from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids  # noqa: E402
from groundmodel.application.resolve_litho_instances_use_case import (  # noqa: E402
    ResolveLithoInstances,
)
from groundmodel.domain.services.strat_field.potential_field import (  # noqa: E402
    fit_potential_field,
)
from groundmodel.domain.services.strat_field.stratigraphic_order import (  # noqa: E402
    NonConformableError,
    build_stratigraphic_order,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import (  # noqa: E402
    LithoBodySolidOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (  # noqa: E402
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402

# The Task-7 invariant helpers — the single home for the ray-cast + overlap math.
from tests.unit.domain.services.strat_field.strat_invariants import (  # type: ignore[import-not-found]  # noqa: E402
    TOL,
    _intervals_overlap,
    vertical_ray_intervals,
)

# The owner's known real model id (lithostratigraphic) on the dev DB.
_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")

# Primary eval grid spacing (m).  2 m ≈ 94k cells over a 620×609 m footprint
# (~10 s build) vs the 1 m default's ~377k cells (~50 s+); keeps the eval
# tractable while still being a real strat build.
_PRIMARY_GRID_SPACING_M = 2.0


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT if it is not the dev ``groundmodel`` DB.

    Safety gate: this script writes ``litho_body_solid`` rows and one
    ``view_state`` knob, so it must run against the app's dev DB and never the
    integration / test DBs (which the integration conftest TRUNCATEs).

    Raises
    ------
    SystemExit
        If the DSN does not name ``groundmodel`` or names an ``_integration`` /
        ``_test`` sibling.
    """
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


async def _set_grid_spacing(session, model_id: UUID, spacing_m: float) -> None:
    """Set ``view_state.litho_segmenter.strat_grid_spacing_m`` on the model's project.

    Reads the project row, merges the key into the JSON ``view_state`` bag, and
    writes it back so ``RecomputeLithoSolids._read_strat_grid_spacing_m`` picks it
    up.  This is an intended dev-DB write (it also makes a later on-click Build use
    the same spacing).

    Parameters
    ----------
    session : AsyncSession
        Active session (committed by the caller).
    model_id : UUID
        The lithostratigraphic model whose project view-state is updated.
    spacing_m : float
        The grid spacing to store.
    """
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        raise SystemExit(f"ABORT: model {model_id} not found.")
    project = await ProjectRepository(session).get_by_id(model.app_project_id)
    if project is None:
        raise SystemExit(f"ABORT: project {model.app_project_id} not found.")
    view_state = dict(project.view_state or {})
    seg = dict(view_state.get("litho_segmenter") or {})
    seg["strat_grid_spacing_m"] = spacing_m
    view_state["litho_segmenter"] = seg
    # Direct UPDATE of the JSON column (a fresh dict reassignment so SQLAlchemy
    # detects the mutation on a JSON/JSONB column without needing MutableDict).
    await session.execute(
        text("UPDATE project SET view_state = CAST(:vs AS jsonb) WHERE id = :pid"),
        {"vs": json.dumps(view_state), "pid": str(project.id)},
    )
    await session.commit()
    print(f"  set strat_grid_spacing_m = {spacing_m} on project {project.id}")


def _iso_range(control) -> tuple[float, float]:
    """Return the (min, max) iso-value over the column's horizons."""
    isos = [h.iso_value for h in control.column.horizons]
    return (min(isos), max(isos)) if isos else (0.0, 0.0)


def _field_max_abs(control, domain) -> tuple[float, tuple[float, float]]:
    """Fit the field, sample F on a coarse dense grid, return max|F| + iso-range.

    Samples a coarse 30x30x30 grid spanning the domain block's bounding box +
    z-span, so the magnitude check covers the interior (where a coordinate-spread
    blow-up shows up between widely-spaced holes), not only the on-contact points.

    Parameters
    ----------
    control : StratControlData
        The assembled Stage-2 control data.
    domain : Block
        The model domain block (bbox + z-span define the sample grid).

    Returns
    -------
    (float, (float, float))
        ``(max(abs(F)), (iso_min, iso_max))``.
    """
    field = fit_potential_field(control, [domain])
    xs = [p[0] for p in domain.polygon]
    ys = [p[1] for p in domain.polygon]
    gx = np.linspace(min(xs), max(xs), 30)
    gy = np.linspace(min(ys), max(ys), 30)
    gz = np.linspace(domain.z_min, domain.z_max, 30)
    mx, my, mz = np.meshgrid(gx, gy, gz, indexing="ij")
    pts = np.column_stack([mx.ravel(), my.ravel(), mz.ravel()])
    vals = field.evaluate([tuple(p) for p in pts])
    return float(np.max(np.abs(vals))), _iso_range(control)


def _authored_columns(picks):
    """Build authored (x, y) columns of ``(formation_id, top_elev, base_elev)``.

    Groups the picks by investigation, converts depths to elevations via
    ``surface_elev - depth``, and orders each stack top → bottom.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        The model's accepted body-assigned picks.

    Returns
    -------
    list[tuple[float, float, list[tuple[str, float, float]]]]
        One ``(x, y, [(formation_id, top_elev, base_elev), ...])`` per
        investigation, units ordered top → bottom.
    """
    by_inv = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)
    cols = []
    for inv_picks in by_inv.values():
        anchor = inv_picks[0]
        units = sorted(
            (
                (
                    p.formation_id,
                    p.surface_elev_m - p.top_depth_m,
                    p.surface_elev_m - p.base_depth_m,
                )
                for p in inv_picks
            ),
            key=lambda u: -u[1],  # descending top elevation = top → bottom
        )
        cols.append((anchor.x_m, anchor.y_m, units))
    return cols


async def _load_solids(session, model_id: UUID):
    """Load the persisted ``litho_body_solid`` rows (vertices+triangles) for the model.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    model_id : UUID
        The model to load solids for.

    Returns
    -------
    list[tuple[str, list, list, bool]]
        ``(body_id_str, vertices, triangles, is_flagged)`` per row.
    """
    rows = (
        (
            await session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    )
    return [
        (
            str(r.body_id),
            [tuple(v) for v in (r.vertices or [])],
            [tuple(t) for t in (r.triangles or [])],
            bool(r.is_flagged),
        )
        for r in rows
    ]


def _overlap_diagnostic(solids, columns):
    """Ray-sample every solid at each authored column; count inter-body overlaps + gaps.

    Reuses the Task-7 ``vertical_ray_intervals`` to recover each body's solid
    ``(base, top)`` intervals at a column and ``_intervals_overlap`` to measure
    interpenetration between DIFFERENT bodies — the exact metric the loft failed.

    Parameters
    ----------
    solids : list[tuple[str, list, list, bool]]
        ``(body_id, vertices, triangles, is_flagged)`` per persisted solid.
    columns : list[tuple[float, float, list]]
        Authored columns ``(x, y, units)``.

    Returns
    -------
    dict
        ``{columns_with_overlap, max_overlap_m, median_overlap_m, coverage_gaps}``.
    """
    built = [(bid, v, t) for bid, v, t, flagged in solids if not flagged and v and t]
    overlaps_per_col = []  # max overlap (m) on a column that has any
    columns_with_overlap = 0
    coverage_gaps = 0
    for x, y, _units in columns:
        per_body = []  # (body_id, (base, top))
        for bid, verts, tris in built:
            for iv in vertical_ray_intervals(verts, tris, x, y):
                per_body.append((bid, iv))
        if not per_body:
            coverage_gaps += 1
            continue
        col_max = 0.0
        for i in range(len(per_body)):
            for j in range(i + 1, len(per_body)):
                bid_i, iv_i = per_body[i]
                bid_j, iv_j = per_body[j]
                if bid_i == bid_j:
                    continue
                ov = _intervals_overlap(iv_i, iv_j)
                if ov > TOL:
                    col_max = max(col_max, ov)
        if col_max > 0.0:
            columns_with_overlap += 1
            overlaps_per_col.append(col_max)
    return {
        "columns_with_overlap": columns_with_overlap,
        "max_overlap_m": max(overlaps_per_col) if overlaps_per_col else 0.0,
        "median_overlap_m": median(overlaps_per_col) if overlaps_per_col else 0.0,
        "coverage_gaps": coverage_gaps,
    }


async def main() -> None:
    """Run the strat-builder real-data eval end to end and print the summary block."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--grid-spacing", type=float, default=_PRIMARY_GRID_SPACING_M)
    ap.add_argument(
        "--also-time-1m",
        action="store_true",
        help="after the primary run, also time a 1.0 m build (only if it stays tractable).",
    )
    args = ap.parse_args()
    model_id = args.model_id

    print("\n=== STRAT BUILDER REAL-DATA EVAL ===\n")
    _confirm_db_target()

    summary: dict[str, object] = {}

    async with AsyncSessionFactory() as session:
        # --- Set the grid spacing on the project view-state ---
        await _set_grid_spacing(session, model_id, args.grid_spacing)

        # --- Stage 0: resolve body_id stamps, load picks ---
        await ResolveLithoInstances(session).execute(model_id=model_id, commit=False)
        repo = LithoLayerRepository(session)
        picks = await repo.load_body_picks(model_id)
        n_inv = len({p.investigation_id for p in picks})
        n_bodies = len({p.body_id for p in picks})
        print(f"\n  loaded {len(picks)} pick(s), {n_inv} investigation(s), {n_bodies} body/bodies")
        summary["picks"] = len(picks)
        summary["investigations"] = n_inv
        summary["resolver_bodies"] = n_bodies

        # --- Stage 1 coherence check ---
        print("\n--- Stage 1: stratigraphic order ---")
        assembler = AssembleStratInputs(session)
        # Mirror AssembleStratInputs.assemble Stage-1 build to surface a cycle
        # explicitly (the use case catches it internally; we want the raw verdict).
        by_inv = defaultdict(list)
        for p in picks:
            by_inv[p.investigation_id].append(p)
        for inv_id in by_inv:
            by_inv[inv_id].sort(key=lambda x: x.top_depth_m)
        from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

        stage1_columns = [
            tuple(
                OrderInputUnit(
                    instance_key=p.body_id,
                    formation_id=p.formation_id,
                    contact_id=f"{p.investigation_id}|{p.body_id}|{p.top_depth_m:.4f}",
                )
                for p in inv_picks
            )
            for inv_picks in by_inv.values()
        ]
        conformable = False
        try:
            order = build_stratigraphic_order(stage1_columns)
            conformable = True
            print(f"  CONFORMABLE — {len(order.horizons)} horizon(s)")
            summary["conformable"] = True
            summary["horizons"] = len(order.horizons)
        except NonConformableError as err:
            print(f"  NON-CONFORMABLE (cycle) — {err}")
            summary["conformable"] = False
            summary["nonconformable_detail"] = str(err)

        # --- Field bounded check (only meaningful if conformable) ---
        print("\n--- Stage 3: field bounded check ---")
        if conformable:
            assembly = assembler.assemble(picks)
            if assembly is None:
                print("  domain UNBUILDABLE (assemble returned None) — skipping field check")
                summary["field_max_abs"] = None
            else:
                try:
                    max_abs, (iso_lo, iso_hi) = _field_max_abs(assembly.control, assembly.domain)
                    print(f"  max|F| = {max_abs:.4g}   iso-range = [{iso_lo:.4g}, {iso_hi:.4g}]")
                    summary["field_max_abs"] = max_abs
                    summary["iso_range"] = (iso_lo, iso_hi)
                except ValueError as err:
                    print(f"  field UNFITTABLE — {err}")
                    summary["field_max_abs"] = None
        else:
            print("  skipped (non-conformable order)")

        # --- Build + persist (timed) ---
        print(f"\n--- Build + persist (force=True, grid={args.grid_spacing} m) ---")
        t0 = time.perf_counter()
        try:
            outcome = await RecomputeLithoSolids(session).execute(model_id, force=True)
            build_s = time.perf_counter() - t0
            print(
                f"  built={outcome.bodies_built} flagged={outcome.bodies_flagged} "
                f"considered={outcome.bodies_considered} orphans_deleted={outcome.orphans_deleted}"
            )
            print(f"  build wall-time @ {args.grid_spacing} m = {build_s:.1f} s")
            summary["bodies_built"] = outcome.bodies_built
            summary["bodies_flagged"] = outcome.bodies_flagged
            summary["bodies_considered"] = outcome.bodies_considered
            summary[f"build_s_{args.grid_spacing}m"] = round(build_s, 1)
        except Exception:  # noqa: BLE001 — capture any unexpected build crash as a finding
            print("  UNEXPECTED EXCEPTION during build:")
            traceback.print_exc()
            summary["build_exception"] = traceback.format_exc()
            outcome = None

    # --- Section-column overlap diagnostic (fresh session, read persisted solids) ---
    print("\n--- Section-column overlap diagnostic (THE HEADLINE) ---")
    async with AsyncSessionFactory() as session:
        solids = await _load_solids(session, model_id)
        # picks are stable across the txn; rebuild authored columns from the
        # same pick set (reload to be safe against the prior session close).
        picks2 = await LithoLayerRepository(session).load_body_picks(model_id)
    columns = _authored_columns(picks2)
    n_flagged = sum(1 for _, _, _, f in solids if f)
    n_real = sum(1 for _, v, t, f in solids if not f and v and t)
    diag = _overlap_diagnostic(solids, columns)
    print(f"  solid rows persisted = {len(solids)}  (real={n_real}, flagged={n_flagged})")
    print(f"  authored columns     = {len(columns)}")
    print(f"  columns with overlap = {diag['columns_with_overlap']}")
    print(f"  max overlap (m)      = {diag['max_overlap_m']:.4f}")
    print(f"  median overlap (m)   = {diag['median_overlap_m']:.4f}")
    print(f"  coverage gaps        = {diag['coverage_gaps']}  (authored columns with NO body)")
    summary["solid_rows"] = len(solids)
    summary["solids_real"] = n_real
    summary["solids_flagged"] = n_flagged
    summary["authored_columns"] = len(columns)
    summary.update(diag)

    # --- Optional 1 m re-time ---
    if args.also_time_1m and args.grid_spacing != 1.0:
        print("\n--- Optional 1.0 m build re-time ---")
        async with AsyncSessionFactory() as session:
            await _set_grid_spacing(session, model_id, 1.0)
            t0 = time.perf_counter()
            outcome1 = await RecomputeLithoSolids(session).execute(model_id, force=True)
            build_1m = time.perf_counter() - t0
            print(f"  build @ 1.0 m = {build_1m:.1f} s  built={outcome1.bodies_built}")
            summary["build_s_1.0m"] = round(build_1m, 1)
            # Restore the primary spacing so the dev-DB state matches the headline run.
            await _set_grid_spacing(session, model_id, args.grid_spacing)

    # --- SUMMARY ---
    print("\n========== SUMMARY ==========")
    for k, v in summary.items():
        if k == "build_exception":
            print(f"  {k}: <traceback captured above>")
        else:
            print(f"  {k}: {v}")
    print("=============================\n")


if __name__ == "__main__":
    asyncio.run(main())
