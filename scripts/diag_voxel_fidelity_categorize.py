"""READ-ONLY diagnostic: categorize every WRONG / UNCOVERED fidelity column.

Systematic-debugging instrument for the voxel-litho build acceptance gate
(``scripts/eval_strat_fidelity.py``).  It does NOT change any production code,
does NOT rebuild, does NOT persist.  It loads the SAME inputs the persisted
build used — the DB picks + persisted solids + the captured ``test.strix``
section partition fixture — reconstructs the EXACT grid axes ``label_voxels``
framed, then for each authored column the gate scores ``wrong`` / ``uncovered``
it determines the dominant cause and tallies the six categories:

1. honor-snap vs eval-sample-cell misalignment
2. above-surface blend sliver (extra unit ABOVE the authored top)
3. sub-voxel thin-layer drop (authored layer < vertical voxel dropped)
4. below-TD deep-band sideways fill (model extends below authored base)
5. genuine reorder / invention WITHIN the observed range (REAL defect)
6. uncovered: alpha-hull edge (legit) vs interior (real defect)

It re-uses the gate's own ``_compute_model_stack`` / ``_classify_column`` /
``_authored_columns`` so its verdict is byte-identical to the gate, then adds
the per-column causal attribution the gate does not compute.

Usage
-----
    uv run python scripts/diag_voxel_fidelity_categorize.py
    uv run python scripts/diag_voxel_fidelity_categorize.py --vertical 0.5
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402

from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column,
    _compute_model_stack,
    _load_formation_names,
    _load_solids,
)
from scripts.eval_voxel_label import _load_sections  # noqa: E402

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_FIXTURE = _REPO_ROOT / "tests" / "fixtures" / "voxel" / "teststrix_partitions.json"
_EPS = 1e-9


def _confirm_db_target() -> None:
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(f"ABORT: DSN names an integration/test DB ({url!r}).")
    print("  DB target OK (dev groundmodel).")


def _grid_axes(sections, h: float, v: float):
    """Reconstruct the exact gx/gy/gz axes label_voxels frames (verbatim logic)."""
    domain = build_domain_from_sections(sections)
    ring = np.asarray(domain.polygon, dtype=float)
    xmin, ymin = float(ring[:, 0].min()), float(ring[:, 1].min())
    xmax, ymax = float(ring[:, 0].max()), float(ring[:, 1].max())
    zmin = math.inf
    zmax = -math.inf
    for s in sections:
        for r in s.regions:
            for _frac, elev in r.polygon:
                zmin = min(zmin, elev)
                zmax = max(zmax, elev)
    gx = np.arange(xmin, xmax + h / 2.0, h)
    gy = np.arange(ymin, ymax + h / 2.0, h)
    gz = np.arange(zmin, zmax + v / 2.0, v)
    return domain, gx, gy, gz


def _categorize(
    authored_units,  # (fid, top_elev, base_elev) top->bottom
    model_stack,  # (fid, base_elev, top_elev) top->bottom
    *,
    x: float,
    y: float,
    gx: np.ndarray,
    gy: np.ndarray,
    gz: np.ndarray,
    vertical_m: float,
    honored_cell: tuple[int, int] | None,
) -> tuple[str, dict]:
    """Return (category_label, detail) for one wrong/uncovered column."""
    auth_seq = [u[0] for u in authored_units]
    model_seq = [r[0] for r in model_stack]

    # --- honor-snap vs eval-sample-cell ---
    ci = int(np.argmin(np.abs(gx - x)))
    cj = int(np.argmin(np.abs(gy - y)))
    eval_cell = (ci, cj)
    dist_to_node = math.hypot(x - float(gx[ci]), y - float(gy[cj]))
    cell_mismatch = honored_cell is not None and eval_cell != honored_cell

    detail = {
        "eval_cell": eval_cell,
        "honored_cell": honored_cell,
        "dist_to_node_m": round(dist_to_node, 3),
        "cell_mismatch": cell_mismatch,
        "auth_seq": auth_seq,
        "model_seq": model_seq,
    }

    if not model_stack:
        # uncovered handled by caller
        return "uncovered", detail

    auth_top = authored_units[0][1]
    auth_base = authored_units[-1][2]
    model_top = max(r[2] for r in model_stack)
    model_base = min(r[1] for r in model_stack)

    # extra unit above authored top?
    extra_above = model_top > auth_top + 0.5 * vertical_m + _EPS
    # extra material below authored base?
    extra_below = model_base < auth_base - 0.5 * vertical_m - _EPS

    # Strip model entries whose MIDPOINT lies above the authored top or below the
    # authored base — these are the above-surface blend slivers (a borehole whose
    # surface is below the global gz_max gets blend material above its log) and
    # the below-TD sideways fill.  Using the midpoint (not "entirely above")
    # correctly excludes a sliver that STRADDLES the authored top boundary, which
    # the "entirely above" test wrongly kept and mis-scored as a reorder.
    # Use HALF a vertical voxel of slack at each boundary so a sliver whose
    # midpoint sits exactly on the authored top/base (a quantised blend voxel at
    # the surface) is treated as out-of-range, not an in-range invention.
    pad = 0.5 * vertical_m + _EPS
    in_range_model = [
        r for r in model_stack if auth_base + pad < 0.5 * (r[1] + r[2]) < auth_top - pad
    ]
    in_range_seq = [r[0] for r in in_range_model]

    # Is the in-range model a subsequence of authored (no reorder/invention)?
    def _is_sub(sub, full):
        it = iter(full)
        return all(any(s == f for f in it) for s in sub)

    in_range_clean = _is_sub(in_range_seq, auth_seq)

    # sub-voxel thin layer: an authored layer thinner than the vertical voxel
    # that is MISSING from the model sequence.
    thin_dropped = []
    for fid, top, base in authored_units:
        if (top - base) < vertical_m + _EPS and fid not in model_seq:
            thin_dropped.append((fid, round(top - base, 3)))

    # --- priority cause attribution ---
    # 1a. this investigation LOST its honor cell to a same-cell collision, so the
    # column is the pure section blend, not its own log — a honor-coverage gap.
    if honored_cell is None:
        detail["collision_lost"] = True
        return "1b-collision-lost-honor", detail
    # 1. cell mismatch (eval samples a non-honored column) — the prime suspect.
    if cell_mismatch:
        return "1-honor-snap-misalign", detail
    # 5. genuine reorder/invention within range — the real defect
    if not in_range_clean:
        detail["in_range_seq"] = in_range_seq
        return "5-genuine-reorder", detail
    # 2. above-surface blend sliver (only discrepancy is extra unit(s) above top)
    if extra_above and in_range_clean and not extra_below:
        return "2-above-surface-sliver", detail
    # 4. below-TD deep-band sideways fill
    if extra_below and in_range_clean and not extra_above:
        return "4-below-TD-fill", detail
    if extra_above and extra_below and in_range_clean:
        return "2+4-above-and-below", detail
    # 3. sub-voxel thin-layer drop (subsequence with a hole, thin layer missing)
    if thin_dropped:
        detail["thin_dropped"] = thin_dropped
        return "3-thin-layer-drop", detail
    # subsequence-with-a-hole, no thin layer identified — a non-thin pinch
    return "6-other-subsequence-hole", detail


async def main() -> None:
    """Run the categorization diagnostic and print the per-cause tally + evidence."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--horizontal", type=float, default=2.0)
    ap.add_argument("--vertical", type=float, default=0.5)
    ap.add_argument("--fixture", type=Path, default=_FIXTURE)
    args = ap.parse_args()

    print("\n=== VOXEL FIDELITY CATEGORIZE DIAGNOSTIC (READ-ONLY) ===\n")
    _confirm_db_target()

    sections, fixture_h = _load_sections(args.fixture)
    h, v = args.horizontal, args.vertical
    print(f"  fixture: {args.fixture.name} — {len(sections)} sections; h={h} v={v}")

    domain, gx, gy, gz = _grid_axes(sections, h, v)
    print(f"  grid axes: {len(gx)} x {len(gy)} x {len(gz)}")
    print(
        f"  x[{gx[0]:.1f}..{gx[-1]:.1f}] y[{gy[0]:.1f}..{gy[-1]:.1f}] z[{gz[0]:.2f}..{gz[-1]:.2f}]"
    )

    async with AsyncSessionFactory() as session:
        formation_names = await _load_formation_names(session, args.model_id)
        repo = LithoLayerRepository(session)
        picks = await repo.load_body_picks(args.model_id)
        solids = await _load_solids(session, args.model_id)

    active_solids = [
        (bid, fid, verts, tris)
        for bid, fid, verts, tris, is_flagged, _stale in solids
        if not is_flagged and verts and tris
    ]
    columns = _authored_columns(picks)
    print(f"  picks: {len(picks)}, columns: {len(columns)}, active solids: {len(active_solids)}")

    # --- replicate the honor-snap cell map exactly (label_voxels logic) ---
    # Build per-investigation columns the same way the use case does, then map
    # each to its nearest grid cell, keeping the lexicographically-smaller id on
    # a collision (verbatim from label_voxels).
    honored_by_cell: dict[tuple[int, int], str] = {}
    inv_coords: dict[str, tuple[float, float]] = {}
    inv_intervals_count: dict[str, int] = {}
    for inv_id, x, y, units in columns:
        inv_coords[inv_id] = (x, y)
        inv_intervals_count[inv_id] = len(units)
    for inv_id in sorted(inv_coords):  # sorted-id order is irrelevant to argmin
        x, y = inv_coords[inv_id]
        if inv_intervals_count[inv_id] == 0:
            continue
        ci = int(np.argmin(np.abs(gx - x)))
        cj = int(np.argmin(np.abs(gy - y)))
        existing = honored_by_cell.get((ci, cj))
        if existing is None or inv_id < existing:
            honored_by_cell[(ci, cj)] = inv_id
    cell_of_inv: dict[str, tuple[int, int]] = {}
    for cell, inv_id in honored_by_cell.items():
        cell_of_inv[inv_id] = cell

    # How many investigations LOST their honored cell to a collision?
    collisions = [
        inv for inv in inv_coords if inv not in cell_of_inv and inv_intervals_count[inv] > 0
    ]

    # --- categorize ---
    tally: dict[str, int] = {}
    wrong_details: list[tuple[str, str, dict]] = []
    uncovered_details: list[tuple[str, dict]] = []
    genuine_defects: list[tuple[str, dict]] = []
    cell_mismatch_dists: list[float] = []
    all_dists: list[float] = []

    for inv_id, x, y, authored_units in columns:
        model_stack = _compute_model_stack(x, y, active_solids)
        ci = int(np.argmin(np.abs(gx - x)))
        cj = int(np.argmin(np.abs(gy - y)))
        all_dists.append(math.hypot(x - float(gx[ci]), y - float(gy[cj])))

        honored_cell = cell_of_inv.get(inv_id)

        if not model_stack:
            # uncovered: is (x,y) inside the alpha hull (interior defect) or
            # outside (legit hull-edge no-data)?
            inside = domain.contains(x, y)
            detail = {
                "inside_hull": inside,
                "honored_cell": honored_cell,
                "eval_cell": (ci, cj),
            }
            cat = "6-uncovered-interior" if inside else "6-uncovered-edge"
            tally[cat] = tally.get(cat, 0) + 1
            uncovered_details.append((inv_id, {**detail, "cat": cat}))
            continue

        verdict = _classify_column(authored_units, model_stack)
        if verdict == "exact":
            continue
        # subsequence + wrong both get categorized (the gate counts subsequence
        # separately but the plan cares about the 33 "wrong" — we categorize all
        # non-exact and label the verdict).
        cat, detail = _categorize(
            authored_units,
            model_stack,
            x=x,
            y=y,
            gx=gx,
            gy=gy,
            gz=gz,
            vertical_m=v,
            honored_cell=honored_cell,
        )
        key = f"{verdict}:{cat}"
        tally[key] = tally.get(key, 0) + 1
        wrong_details.append((inv_id, key, detail))
        if detail.get("cell_mismatch"):
            cell_mismatch_dists.append(detail["dist_to_node_m"])
        if cat == "5-genuine-reorder":
            genuine_defects.append((inv_id, {**detail, "verdict": verdict}))

    # --- report ---
    print("\n" + "=" * 64)
    print("  HONOR-SNAP CELL MAP")
    print("=" * 64)
    print(f"  investigations honored        : {len(cell_of_inv)}")
    print(f"  LOST to same-cell collision   : {len(collisions)}")
    if collisions:
        for inv in collisions[:20]:
            x, y = inv_coords[inv]
            ci = int(np.argmin(np.abs(gx - x)))
            cj = int(np.argmin(np.abs(gy - y)))
            winner = honored_by_cell.get((ci, cj))
            print(f"    - {inv}  cell {(ci, cj)} taken by {winner}")

    print("\n" + "=" * 64)
    print("  DISTANCE: true (x,y) -> nearest grid node centre")
    print("=" * 64)
    arr = np.array(all_dists)
    print(
        f"  all columns (n={len(arr)}): mean={arr.mean():.3f} median={np.median(arr):.3f} "
        f"p90={np.percentile(arr, 90):.3f} max={arr.max():.3f} m"
    )
    if cell_mismatch_dists:
        cm = np.array(cell_mismatch_dists)
        print(
            f"  cell-mismatch cols (n={len(cm)}): mean={cm.mean():.3f} "
            f"median={np.median(cm):.3f} max={cm.max():.3f} m"
        )
    else:
        print("  cell-mismatch cols: NONE (eval cell == honored cell for every wrong column)")

    print("\n" + "=" * 64)
    print("  CATEGORY TALLY (verdict:cause)")
    print("=" * 64)
    for key in sorted(tally):
        print(f"  {key:42s}: {tally[key]}")

    print("\n" + "=" * 64)
    print("  CATEGORY-5 GENUINE DEFECTS (reorder/invention within observed range)")
    print("=" * 64)
    if not genuine_defects:
        print("  NONE — no column has a reorder/invention within its observed range.")
    for inv_id, d in genuine_defects:
        fn = lambda fid: formation_names.get(fid, fid[:8])  # noqa: E731
        print(f"\n  [{d['verdict']}] inv {inv_id}")
        print(f"    authored seq : {[fn(f) for f in d['auth_seq']]}")
        print(f"    model seq    : {[fn(f) for f in d['model_seq']]}")
        print(f"    in-range seq : {[fn(f) for f in d.get('in_range_seq', [])]}")
        print(
            f"    eval cell    : {d['eval_cell']}  honored cell: {d['honored_cell']}  "
            f"dist={d['dist_to_node_m']} m"
        )

    print("\n" + "=" * 64)
    print("  UNCOVERED COLUMNS")
    print("=" * 64)
    edge = sum(1 for _i, d in uncovered_details if d["cat"] == "6-uncovered-edge")
    interior = sum(1 for _i, d in uncovered_details if d["cat"] == "6-uncovered-interior")
    print(f"  hull-edge (legit no-data) : {edge}")
    print(f"  interior (REAL defect)    : {interior}")
    for inv_id, d in uncovered_details:
        x, y = inv_coords[inv_id]
        print(
            f"    - {inv_id}  ({x:.1f},{y:.1f})  inside_hull={d['inside_hull']}  "
            f"honored_cell={d['honored_cell']}"
        )

    # --- a few wrong examples per non-genuine category ---
    print("\n" + "=" * 64)
    print("  SAMPLE WRONG/SUBSEQUENCE COLUMNS (first 2 per cause)")
    print("=" * 64)
    seen_cause: dict[str, int] = {}
    fn = lambda fid: formation_names.get(fid, fid[:8])  # noqa: E731
    for inv_id, key, d in wrong_details:
        if seen_cause.get(key, 0) >= 2:
            continue
        seen_cause[key] = seen_cause.get(key, 0) + 1
        print(f"\n  [{key}] inv {inv_id}")
        print(f"    authored : {[fn(f) for f in d['auth_seq']]}")
        print(f"    model    : {[fn(f) for f in d['model_seq']]}")
        if "thin_dropped" in d:
            print(f"    thin_dropped(<{v}m): {[(fn(f), t) for f, t in d['thin_dropped']]}")
        print(
            f"    eval_cell={d['eval_cell']} honored_cell={d['honored_cell']} "
            f"dist={d['dist_to_node_m']}m mismatch={d['cell_mismatch']}"
        )

    print("\n=== DIAGNOSTIC COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
