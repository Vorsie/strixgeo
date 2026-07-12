"""Read-only diagnostic: model-vs-accepted fidelity + render-cost for a built litho model.

Reads the PERSISTED ``litho_body_solid`` rows and the accepted ``litho_layer``
picks for one lithostratigraphic model and reports five evidence blocks:

A. FIDELITY — formation sequence + contact-depth accuracy at every investigation.
B. VERTICAL GAPS — intra-column voids between consecutive model bodies.
C. RENDER COST PROXY — total/max triangle + vertex counts across all solids.
D. SANITY — confirms the expected solid count + flagged count + grid spacing.
E. WORST COLUMNS — 3–5 verbatim side-by-side accepted-vs-model stacks.

This script is STRICTLY READ-ONLY: it issues only SELECT statements.  A guard
at the top of ``main`` aborts when the DB is not the dev ``groundmodel`` DB and
when the DB is an integration/test sibling — the same guard as
``eval_strat_builder.py``.

Usage
-----
    uv run python scripts/eval_strat_fidelity.py
    uv run python scripts/eval_strat_fidelity.py --model-id <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from pathlib import Path
from uuid import UUID

# The strat-invariant ray-cast helpers live under ``tests/`` (single home for
# the solid-interval math).  Bootstrap sys.path before any first-party import.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
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

# The ray-cast + interval helpers (the single home for this geometry).
from tests.unit.domain.services.voxel_litho.strat_invariants import (  # type: ignore[import-not-found]  # noqa: E402
    TOL,
    _union_intervals,
    vertical_ray_intervals,
)

# Owner's known real lithostratigraphic model on the dev DB.
_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")

# A vertical gap larger than this between consecutive body intervals is reported
# as a real gap (below = touching seam noise; above = a hole).
_GAP_THRESHOLD_M = 0.1

# Contact-depth error buckets (in metres).
_BUCKET_05 = 0.5
_BUCKET_1 = 1.0
_BUCKET_2 = 2.0


# ---------------------------------------------------------------------------
# DB safety guard (identical pattern to eval_strat_builder.py)
# ---------------------------------------------------------------------------


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT when it is not the dev ``groundmodel`` DB.

    This script is read-only, but the guard lives here for consistency and
    future-proofing (an accidental write path would otherwise mutate the
    integration DB and wipe the Playwright fixture).

    Raises
    ------
    SystemExit
        When the DSN does not contain ``groundmodel`` or names an
        ``_integration`` / ``_test`` sibling.
    """
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' — refusing to run ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(
            f"ABORT: DSN names an integration/test DB — run against the dev "
            f"'groundmodel' DB only ({url!r})."
        )
    print("  DB target OK (dev groundmodel).")


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------


async def _load_formation_names(session, model_id: UUID) -> dict[str, str]:
    """Return a ``{formation_id_str: human_readable_label}`` map for the model's project.

    Uses ``name`` as the primary label (e.g. "ZAND", "KLEI") with the
    ``litho_main_soil_code`` as fallback so UUID-only displays are avoided.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    model_id : UUID
        The lithostratigraphic model; used to resolve the owning project.

    Returns
    -------
    dict[str, str]
        Keyed by ``str(formation_id)``, value is the display name.
    """
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        return {}
    project = await ProjectRepository(session).get_by_id(model.app_project_id)
    if project is None:
        return {}
    rows = list(
        (
            await session.execute(
                select(
                    GeologicalFormationOrm.id,
                    GeologicalFormationOrm.name,
                    GeologicalFormationOrm.litho_main_soil_code,
                ).where(GeologicalFormationOrm.app_project_id == project.id)
            )
        ).all()
    )
    result: dict[str, str] = {}
    for row in rows:
        label = row.name or row.litho_main_soil_code or str(row.id)
        result[str(row.id)] = label
    return result


async def _load_solids(session, model_id: UUID) -> list[tuple[str, str, list, list, bool, bool]]:
    """Load persisted ``litho_body_solid`` rows for the model.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    model_id : UUID
        The model to load solids for.

    Returns
    -------
    list[tuple[str, str, list, list, bool, bool]]
        Each element is ``(body_id_str, formation_id_str, vertices, triangles,
        is_flagged, is_stale)``.
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
            str(r.formation_id),
            [tuple(v) for v in (r.vertices or [])],
            [tuple(t) for t in (r.triangles or [])],
            bool(r.is_flagged),
            bool(r.is_stale),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Authored column builder (mirrors _authored_columns in eval_strat_builder.py)
# ---------------------------------------------------------------------------


def _authored_columns(
    picks,
) -> list[tuple[str, float, float, list[tuple[str, float, float]]]]:
    """Group picks into per-investigation authored stacks.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        Accepted body-assigned picks from ``LithoLayerRepository.load_body_picks``.

    Returns
    -------
    list[tuple[str, float, float, list[tuple[str, float, float]]]]
        Each element is ``(investigation_id, x_m, y_m, units)`` where
        ``units`` is a list of ``(formation_id, top_elev_m, base_elev_m)``
        sorted top→bottom.
    """
    by_inv: dict[str, list] = defaultdict(list)
    coords: dict[str, tuple[float, float]] = {}
    for p in picks:
        by_inv[p.investigation_id].append(p)
        coords[p.investigation_id] = (p.x_m, p.y_m)

    cols = []
    for inv_id, inv_picks in by_inv.items():
        x, y = coords[inv_id]
        units = sorted(
            (
                (
                    p.formation_id,
                    p.surface_elev_m - p.top_depth_m,
                    p.surface_elev_m - p.base_depth_m,
                )
                for p in inv_picks
            ),
            key=lambda u: -u[1],  # descending top elevation = top→bottom
        )
        cols.append((inv_id, x, y, units))
    return cols


# ---------------------------------------------------------------------------
# Section A — fidelity (model vs accepted lithos)
# ---------------------------------------------------------------------------


def _compute_model_stack(
    x: float,
    y: float,
    active_solids: list[tuple[str, str, list, list]],
) -> list[tuple[str, float, float]]:
    """Ray-sample all active solids at (x, y) and return the model column.

    Collapses consecutive same-formation touching intervals, sorts top→bottom.

    Parameters
    ----------
    x, y : float
        World coordinates.
    active_solids : list[tuple[str, str, list, list]]
        ``(body_id, formation_id, vertices, triangles)`` tuples for unflagged
        solids with non-empty geometry.

    Returns
    -------
    list[tuple[str, float, float]]
        ``(formation_id, base_elev_m, top_elev_m)`` sorted top→bottom.
        Empty when no body covers this point.
    """
    raw: list[tuple[str, float, float]] = []
    for _bid, fid, verts, tris in active_solids:
        for base, top in vertical_ray_intervals(verts, tris, x, y):
            raw.append((fid, base, top))

    if not raw:
        return []

    # Sort top→bottom (descending top elevation).
    raw.sort(key=lambda r: -r[2])

    # Collapse consecutive same-formation touching intervals.
    collapsed: list[tuple[str, float, float]] = []
    for fid, base, top in raw:
        if collapsed and collapsed[-1][0] == fid and top >= collapsed[-1][1] - TOL:
            prev_fid, prev_base, prev_top = collapsed[-1]
            collapsed[-1] = (prev_fid, min(prev_base, base), max(prev_top, top))
        else:
            collapsed.append((fid, base, top))
    return collapsed


def _classify_column(
    authored_units: list[tuple[str, float, float]],
    model_stack: list[tuple[str, float, float]],
) -> str:
    """Classify the model column relative to the authored column.

    Parameters
    ----------
    authored_units : list[tuple[str, float, float]]
        ``(formation_id, top_elev_m, base_elev_m)`` top→bottom.
    model_stack : list[tuple[str, float, float]]
        ``(formation_id, base_elev_m, top_elev_m)`` top→bottom (model output).

    Returns
    -------
    str
        One of ``"exact"``, ``"subsequence"`` (model missing some authored
        units — a pinch-out), or ``"wrong"`` (reorder or invented formation).
    """
    auth_seq = [u[0] for u in authored_units]
    model_seq = [r[0] for r in model_stack]

    if auth_seq == model_seq:
        return "exact"

    # model_seq must be a subsequence of auth_seq (no reorder, no spurious).
    it = iter(auth_seq)
    is_sub = all(any(s == f for f in it) for s in model_seq)
    return "subsequence" if is_sub else "wrong"


def _fidelity_analysis(
    columns: list[tuple[str, float, float, list]],
    active_solids: list[tuple[str, str, list, list]],
    formation_names: dict[str, str],
) -> dict:
    """Compute the full fidelity block (Section A).

    Parameters
    ----------
    columns : list[tuple[str, float, float, list]]
        ``(inv_id, x, y, authored_units)`` per investigation.
    active_solids : list[tuple[str, str, list, list]]
        ``(body_id, formation_id, vertices, triangles)`` for unflagged solids.
    formation_names : dict[str, str]
        ``{formation_id_str: label}`` for human-readable reporting.

    Returns
    -------
    dict
        The fidelity evidence block.  Keys: ``covered``, ``uncovered``,
        ``uncovered_details``, ``exact``, ``subsequence``, ``wrong``,
        ``depth_errors``, ``per_lithology_errors``, ``worst_columns``.
    """
    covered = 0
    uncovered = 0
    uncovered_details: list[dict] = []
    exact = 0
    subsequence = 0
    wrong = 0

    depth_errors: list[float] = []
    per_litho_errors: dict[str, list[float]] = defaultdict(list)

    # For "worst columns" reporting: (max_depth_error, inv_id, authored, model).
    worst: list[tuple[float, str, list, list]] = []

    for inv_id, x, y, authored_units in columns:
        model_stack = _compute_model_stack(x, y, active_solids)

        if not model_stack:
            uncovered += 1
            uncovered_details.append({"inv_id": inv_id, "x": round(x, 1), "y": round(y, 1)})
            continue

        covered += 1

        # Sequence classification.
        verdict = _classify_column(authored_units, model_stack)
        if verdict == "exact":
            exact += 1
        elif verdict == "subsequence":
            subsequence += 1
        else:
            wrong += 1

        # Contact-depth error: compare each authored unit's base elevation to
        # the corresponding model interval's base elevation (paired by
        # formation_id in authored order, tolerating pinch-outs in the model).
        auth_units_seq = [(fid, top, base) for fid, top, base in authored_units]
        model_map = [(fid, base, top) for fid, base, top in model_stack]

        col_max_err = 0.0
        model_pos = 0
        for fid, _auth_top, auth_base in auth_units_seq:
            # Advance to first model interval with this formation_id.
            while model_pos < len(model_map) and model_map[model_pos][0] != fid:
                model_pos += 1
            if model_pos >= len(model_map):
                break
            _, m_base, _m_top = model_map[model_pos]
            err = abs(m_base - auth_base)
            depth_errors.append(err)
            litho_label = formation_names.get(fid, fid[:8])
            per_litho_errors[litho_label].append(err)
            col_max_err = max(col_max_err, err)
            model_pos += 1

        # Collect worst columns (top 5 by max contact-depth error in column).
        worst.append((col_max_err, inv_id, auth_units_seq, model_map))

    # Sort worst descending by max error, take top 5.
    worst.sort(key=lambda w: -w[0])
    worst_columns = []
    for max_err, inv_id, auth_units_seq, model_map in worst[:5]:
        worst_columns.append(
            {
                "inv_id": inv_id,
                "max_contact_err_m": round(max_err, 3),
                "authored": [
                    {
                        "formation": formation_names.get(fid, fid[:8]),
                        "top": round(top, 3),
                        "base": round(base, 3),
                    }
                    for fid, top, base in auth_units_seq
                ],
                "model": [
                    {
                        "formation": formation_names.get(fid, fid[:8]),
                        "base": round(base, 3),
                        "top": round(top, 3),
                    }
                    for fid, base, top in model_map
                ],
            }
        )

    # Depth error distribution.
    dep_arr = sorted(depth_errors)
    n = len(dep_arr)
    if n:
        mean_err = float(np.mean(dep_arr))
        median_err = float(np.median(dep_arr))
        p90_err = float(np.percentile(dep_arr, 90))
        max_err = float(dep_arr[-1])
        within_05 = sum(1 for e in dep_arr if e <= _BUCKET_05)
        within_1 = sum(1 for e in dep_arr if e <= _BUCKET_1)
        beyond_2 = sum(1 for e in dep_arr if e > _BUCKET_2)
    else:
        mean_err = median_err = p90_err = max_err = 0.0
        within_05 = within_1 = beyond_2 = 0

    # Per-lithology summary.
    per_litho_summary: dict[str, dict] = {}
    for litho, errs in sorted(per_litho_errors.items()):
        arr = sorted(errs)
        per_litho_summary[litho] = {
            "n": len(arr),
            "mean": round(float(np.mean(arr)), 3),
            "median": round(float(np.median(arr)), 3),
            "p90": round(float(np.percentile(arr, 90)), 3),
            "max": round(float(arr[-1]), 3),
        }

    return {
        "covered": covered,
        "uncovered": uncovered,
        "uncovered_details": uncovered_details,
        "exact": exact,
        "subsequence": subsequence,
        "wrong": wrong,
        "depth_errors_n": n,
        "depth_err_mean_m": round(mean_err, 3),
        "depth_err_median_m": round(median_err, 3),
        "depth_err_p90_m": round(p90_err, 3),
        "depth_err_max_m": round(max_err, 3),
        "within_05m": within_05,
        "within_1m": within_1,
        "beyond_2m": beyond_2,
        "per_litho": per_litho_summary,
        "worst_columns": worst_columns,
    }


# ---------------------------------------------------------------------------
# Section B — intra-column vertical gaps
# ---------------------------------------------------------------------------


def _gap_analysis(
    columns: list[tuple[str, float, float, list]],
    active_solids: list[tuple[str, str, list, list]],
) -> dict:
    """Find intra-column vertical gaps where bodies are present but leave holes.

    A gap is a span > ``_GAP_THRESHOLD_M`` between consecutive model body
    intervals at a covered column, in a depth range where the authored column
    has material.

    Parameters
    ----------
    columns : list[tuple[str, float, float, list]]
        ``(inv_id, x, y, authored_units)`` per investigation.
    active_solids : list[tuple[str, str, list, list]]
        ``(body_id, formation_id, vertices, triangles)`` for unflagged solids.

    Returns
    -------
    dict
        ``{cols_with_gaps, total_gap_m, max_gap_m, gap_details}``.
    """
    cols_with_gaps = 0
    total_gap_m = 0.0
    max_gap_m = 0.0
    gap_details: list[dict] = []

    for inv_id, x, y, authored_units in columns:
        # Collect all body intervals (any formation) at this column.
        all_intervals: list[tuple[float, float]] = []
        for _bid, _fid, verts, tris in active_solids:
            for iv in vertical_ray_intervals(verts, tris, x, y):
                all_intervals.append(iv)

        if not all_intervals:
            continue  # uncovered — already counted in Section A

        # Merge intervals (seams between adjacent bodies should be noise-level).
        merged = _union_intervals(all_intervals)

        # Authored depth range: from shallowest top to deepest base.
        auth_top = authored_units[0][1]  # top_elev_m of the topmost unit
        auth_base = authored_units[-1][2]  # base_elev_m of the deepest unit

        # Find gaps between consecutive merged intervals, within the authored range.
        col_gap_m = 0.0
        for i in range(len(merged) - 1):
            gap_base = merged[i][1]  # top of lower interval = base of gap
            gap_top = merged[i + 1][0]  # bottom of higher interval = top of gap
            # Note: intervals are sorted base→top, so merged[i] is BELOW merged[i+1].
            # Actually _union_intervals returns sorted (base, top) ascending in base,
            # so merged[0] has the smallest base (deepest), merged[-1] the highest base.
            # Re-sort by base ascending means gap spans from merged[i].top to merged[i+1].base.
            gap_size = merged[i + 1][0] - merged[i][1]
            if gap_size <= _GAP_THRESHOLD_M:
                continue
            # The gap must overlap the authored depth range.
            gap_lo = merged[i][1]
            gap_hi = merged[i + 1][0]
            overlap_lo = max(gap_lo, auth_base)
            overlap_hi = min(gap_hi, auth_top)
            if overlap_hi <= overlap_lo:
                continue
            effective_gap = overlap_hi - overlap_lo
            col_gap_m += effective_gap
            max_gap_m = max(max_gap_m, effective_gap)

        if col_gap_m > 0.0:
            cols_with_gaps += 1
            total_gap_m += col_gap_m
            gap_details.append(
                {
                    "inv_id": inv_id,
                    "gap_m": round(col_gap_m, 3),
                    "x": round(x, 1),
                    "y": round(y, 1),
                }
            )

    # Sort largest gaps first.
    gap_details.sort(key=lambda d: -d["gap_m"])

    return {
        "cols_with_gaps": cols_with_gaps,
        "total_gap_m": round(total_gap_m, 3),
        "max_gap_m": round(max_gap_m, 3),
        "gap_details": gap_details[:10],  # top 10 worst
    }


# ---------------------------------------------------------------------------
# Section C — render cost proxy
# ---------------------------------------------------------------------------


def _render_cost(solids: list) -> dict:
    """Count triangles + vertices across all unflagged solids.

    Parameters
    ----------
    solids : list[tuple[str, str, list, list, bool, bool]]
        ``(body_id, formation_id, vertices, triangles, is_flagged, is_stale)``.

    Returns
    -------
    dict
        ``{total_triangles, total_vertices, max_triangles_single_body,
           bodies_over_50k_tris, triangle_distribution}``.
    """
    total_tris = 0
    total_verts = 0
    max_tris = 0
    over_50k = 0
    tri_counts: list[int] = []

    for _bid, _fid, verts, tris, is_flagged, _is_stale in solids:
        if is_flagged:
            continue
        n_tris = len(tris)
        n_verts = len(verts)
        total_tris += n_tris
        total_verts += n_verts
        max_tris = max(max_tris, n_tris)
        if n_tris > 50_000:
            over_50k += 1
        tri_counts.append(n_tris)

    tri_arr = sorted(tri_counts)
    n = len(tri_arr)
    if n:
        p50 = int(np.percentile(tri_arr, 50))
        p90 = int(np.percentile(tri_arr, 90))
        p99 = int(np.percentile(tri_arr, 99))
    else:
        p50 = p90 = p99 = 0

    return {
        "unflagged_solids": n,
        "total_triangles": total_tris,
        "total_vertices": total_verts,
        "max_triangles_single_body": max_tris,
        "bodies_over_50k_tris": over_50k,
        "tri_p50": p50,
        "tri_p90": p90,
        "tri_p99": p99,
    }


# ---------------------------------------------------------------------------
# Grid spacing reader (Section D sanity)
# ---------------------------------------------------------------------------


async def _read_grid_spacing(session, model_id: UUID) -> float | None:
    """Return the ``strat_grid_spacing_m`` from the model's project view_state.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    model_id : UUID
        The lithostratigraphic model.

    Returns
    -------
    float | None
        The spacing in metres, or ``None`` when not set.
    """
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        return None
    project = await ProjectRepository(session).get_by_id(model.app_project_id)
    if project is None:
        return None
    vs = project.view_state or {}
    seg = vs.get("litho_segmenter") or {}
    val = seg.get("strat_grid_spacing_m")
    return float(val) if val is not None else None


# ---------------------------------------------------------------------------
# Pretty-print helpers
# ---------------------------------------------------------------------------


def _print_section(title: str) -> None:
    """Print a section header."""
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print("=" * 60)


def _print_worst_columns(worst: list[dict], formation_names: dict[str, str]) -> None:
    """Print verbatim side-by-side stacks for the worst columns.

    Parameters
    ----------
    worst : list[dict]
        Up to 5 dicts from the fidelity analysis, sorted worst-first.
    formation_names : dict[str, str]
        Not used directly here (labels already baked in during analysis).
    """
    for i, col in enumerate(worst, 1):
        print(
            f"\n  [{i}] Investigation: {col['inv_id']}"
            f"   max_contact_err = {col['max_contact_err_m']:.3f} m"
        )
        auth_rows = col["authored"]
        mod_rows = col["model"]
        max_rows = max(len(auth_rows), len(mod_rows))
        print(f"  {'AUTHORED':40s}  {'MODEL':40s}")
        print(f"  {'-' * 40}  {'-' * 40}")
        for j in range(max_rows):
            if j < len(auth_rows):
                a = auth_rows[j]
                a_str = f"{a['formation']:12s}  top={a['top']:7.2f}  base={a['base']:7.2f}"
            else:
                a_str = ""
            if j < len(mod_rows):
                m = mod_rows[j]
                m_str = f"{m['formation']:12s}  top={m['top']:7.2f}  base={m['base']:7.2f}"
            else:
                m_str = ""
            print(f"  {a_str:40s}  {m_str:40s}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    """Run the fidelity + render-cost diagnostic and print the full evidence block."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    args = ap.parse_args()
    model_id = args.model_id

    print("\n=== STRAT MODEL FIDELITY + RENDER-COST DIAGNOSTIC (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        # --- Load formation name map ---
        formation_names = await _load_formation_names(session, model_id)
        print(f"  loaded {len(formation_names)} formation name(s)")

        # --- Load accepted picks ---
        repo = LithoLayerRepository(session)
        picks = await repo.load_body_picks(model_id)
        n_inv = len({p.investigation_id for p in picks})
        n_bodies = len({p.body_id for p in picks})
        print(
            f"  loaded {len(picks)} pick(s), {n_inv} investigation(s), {n_bodies} resolver bodies"
        )

        # --- Load persisted solids ---
        solids = await _load_solids(session, model_id)

        # --- Grid spacing (sanity) ---
        grid_spacing = await _read_grid_spacing(session, model_id)

    # --- Section D: sanity ---
    n_solid_total = len(solids)
    n_flagged = sum(1 for *_, is_flagged, _s in solids if is_flagged)
    n_stale = sum(1 for *_, is_flagged, is_stale in solids if is_stale)
    n_real = n_solid_total - n_flagged

    _print_section("D. SANITY")
    print(f"  solid rows persisted : {n_solid_total}")
    print(f"  unflagged (real)     : {n_real}")
    print(f"  flagged              : {n_flagged}")
    print(f"  stale                : {n_stale}")
    print(f"  grid_spacing_m       : {grid_spacing}")
    print(f"  investigated columns : {n_inv}")
    print(f"  resolver bodies      : {n_bodies}")

    # Active solids: unflagged and have actual geometry.
    active_solids = [
        (bid, fid, verts, tris)
        for bid, fid, verts, tris, is_flagged, _is_stale in solids
        if not is_flagged and verts and tris
    ]

    columns = _authored_columns(picks)

    # --- Section C: render cost (cheap — just counts, before the ray-casts) ---
    render = _render_cost(solids)
    _print_section("C. RENDER COST PROXY")
    print(f"  unflagged solids       : {render['unflagged_solids']}")
    print(f"  total triangles        : {render['total_triangles']:,}")
    print(f"  total vertices         : {render['total_vertices']:,}")
    print(f"  max triangles (1 body) : {render['max_triangles_single_body']:,}")
    print(f"  bodies > 50k tris      : {render['bodies_over_50k_tris']}")
    print(
        f"  tri p50 / p90 / p99    : {render['tri_p50']:,} / {render['tri_p90']:,} / {render['tri_p99']:,}"
    )

    # --- Section A: fidelity (expensive — ray-casts per column × solid) ---
    print(
        f"\n  Running fidelity analysis over {len(columns)} columns × {len(active_solids)} active solids..."
    )
    fidelity = _fidelity_analysis(columns, active_solids, formation_names)

    _print_section("A. FIDELITY — model vs accepted lithos")
    n_total_cols = fidelity["covered"] + fidelity["uncovered"]
    print(f"  total authored columns   : {n_total_cols}")
    print(
        f"  covered by model         : {fidelity['covered']} ({100 * fidelity['covered'] // max(n_total_cols, 1)} %)"
    )
    print(f"  uncovered (no body)      : {fidelity['uncovered']}")
    if fidelity["uncovered_details"]:
        for d in fidelity["uncovered_details"]:
            print(f"    - inv {d['inv_id']}  ({d['x']}, {d['y']})")
    print()
    print("  Sequence fidelity (covered only):")
    print(f"    exact match            : {fidelity['exact']}")
    print(f"    subsequence (pinch)    : {fidelity['subsequence']}")
    print(f"    wrong (reorder/invent) : {fidelity['wrong']}")
    print()
    print(f"  Contact-depth errors ({fidelity['depth_errors_n']} contacts):")
    print(f"    mean                   : {fidelity['depth_err_mean_m']:.3f} m")
    print(f"    median                 : {fidelity['depth_err_median_m']:.3f} m")
    print(f"    p90                    : {fidelity['depth_err_p90_m']:.3f} m")
    print(f"    max                    : {fidelity['depth_err_max_m']:.3f} m")
    print(f"    within 0.5 m           : {fidelity['within_05m']} / {fidelity['depth_errors_n']}")
    print(f"    within 1.0 m           : {fidelity['within_1m']} / {fidelity['depth_errors_n']}")
    print(f"    beyond 2.0 m           : {fidelity['beyond_2m']} / {fidelity['depth_errors_n']}")
    print()
    print("  Per-lithology depth error breakdown:")
    for litho, stats in fidelity["per_litho"].items():
        print(
            f"    {litho:15s} n={stats['n']:3d}  "
            f"mean={stats['mean']:.3f}  median={stats['median']:.3f}  "
            f"p90={stats['p90']:.3f}  max={stats['max']:.3f}  m"
        )

    # --- Section B: vertical gaps ---
    gap = _gap_analysis(columns, active_solids)
    _print_section("B. VERTICAL GAPS (intra-column, bodies present but hole between them)")
    print(f"  columns with gaps        : {gap['cols_with_gaps']}")
    print(f"  total gap metres         : {gap['total_gap_m']:.3f} m")
    print(f"  max single gap           : {gap['max_gap_m']:.3f} m")
    if gap["gap_details"]:
        print("  largest gaps (up to 10):")
        for d in gap["gap_details"]:
            print(f"    - inv {d['inv_id']}  gap={d['gap_m']:.3f} m  ({d['x']}, {d['y']})")

    # --- Section E: worst columns ---
    _print_section("E. WORST COLUMNS (3–5 largest contact-depth errors)")
    _print_worst_columns(fidelity["worst_columns"], formation_names)

    print("\n=== DIAGNOSTIC COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
