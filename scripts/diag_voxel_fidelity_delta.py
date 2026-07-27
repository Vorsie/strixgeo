"""READ-ONLY A/B: voxel fidelity with the feet-only vs widened model footprint.

Controlled real-data measurement of the footprint fix.  Both arms run the FULL
pipeline (``build_domain_from_sections`` → ``label_voxels`` →
``extract_body_solids``) on IDENTICAL inputs — the same captured 2-D partition
payload, the same DB picks, the same geological surfaces, the same grid
spacings — and differ in exactly one thing:

* ``BEFORE`` — the footprint is the alpha hull of the section columns' PROJECTED
  FEET only (the behaviour before the fix).
* ``AFTER``  — the footprint also covers the investigations' TRUE drilled
  positions (``investigation_positions``), which is where ``label_voxels``
  honors their own logs.

Each arm is then scored with ``eval_strat_fidelity``'s OWN functions
(``_compute_model_stack`` / ``_classify_column``) so the verdicts are directly
comparable to the acceptance gate's numbers, and the delta is printed.

Nothing is persisted: the meshes stay in memory and the DB is only read.  The
usual dev-DB guard applies.

Usage
-----
    uv run python scripts/diag_voxel_fidelity_delta.py \
        --payload scripts/throwaway_v2_voxel_payload.json --vertical 0.25
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (  # noqa: E402
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_voxel_label_columns import _load_payload, _slug  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column,
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_v2_voxel_payload.json"


def _score(
    columns: list[tuple[str, float, float, list]],
    meshes: list,
) -> dict:
    """Score one arm's meshes against the authored columns.

    Parameters
    ----------
    columns : list of (str, float, float, list)
        ``(investigation_id, x, y, authored_units)`` per investigation.
    meshes : list of LithoBodyMesh
        The arm's extracted body solids.

    Returns
    -------
    dict
        ``covered`` / ``uncovered`` / ``uncovered_ids`` / ``exact`` /
        ``subsequence`` / ``wrong`` / ``wrong_ids`` / ``depth_errors``.
    """
    active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]
    out = {
        "covered": 0,
        "uncovered": 0,
        "uncovered_ids": [],
        "exact": 0,
        "subsequence": 0,
        "wrong": 0,
        "wrong_ids": [],
        "depth_errors": [],
    }
    for inv_id, x, y, authored in columns:
        stack = _compute_model_stack(x, y, active)
        if not stack:
            out["uncovered"] += 1
            out["uncovered_ids"].append(_slug(inv_id))
            continue
        out["covered"] += 1
        verdict = _classify_column(authored, stack)
        out[verdict] += 1
        if verdict == "wrong":
            out["wrong_ids"].append(_slug(inv_id))
        # Contact-depth error, paired by formation in authored order — the same
        # walk the acceptance gate does.
        model_map = [(fid, base, top) for fid, base, top in stack]
        pos = 0
        for fid, _top, auth_base in authored:
            while pos < len(model_map) and model_map[pos][0] != fid:
                pos += 1
            if pos >= len(model_map):
                break
            out["depth_errors"].append(abs(model_map[pos][1] - auth_base))
            pos += 1
    return out


def _summarise(name: str, res: dict, elapsed: float, grid_shape: tuple[int, int, int]) -> None:
    """Print one arm's scored result.

    Parameters
    ----------
    name : str
        Arm label (``BEFORE`` / ``AFTER``).
    res : dict
        The scored result from :func:`_score`.
    elapsed : float
        Wall-clock seconds for the arm.
    grid_shape : tuple[int, int, int]
        The labelled grid's ``(nx, ny, nz)``.
    """
    errs = sorted(res["depth_errors"])
    total = res["covered"] + res["uncovered"]
    print(f"\n  --- {name} ---  grid {'x'.join(str(n) for n in grid_shape)}  [{elapsed:.1f}s]")
    print(f"    covered / total       : {res['covered']} / {total}")
    print(f"    uncovered             : {res['uncovered']}  {res['uncovered_ids']}")
    print(f"    exact                 : {res['exact']}")
    print(f"    subsequence (pinch)   : {res['subsequence']}")
    print(f"    wrong (reorder/invent): {res['wrong']}  {res['wrong_ids']}")
    if errs:
        print(
            f"    contact err  median={np.median(errs):.3f}  "
            f"p90={np.percentile(errs, 90):.3f}  max={errs[-1]:.3f}  (n={len(errs)})"
        )


async def main() -> None:
    """Run both arms on identical inputs and print the fidelity delta."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--payload", type=Path, default=_DEFAULT_PAYLOAD)
    ap.add_argument("--horizontal", type=float, default=None)
    ap.add_argument("--vertical", type=float, default=None)
    args = ap.parse_args()

    print("\n=== VOXEL FIDELITY A/B — footprint feet-only vs widened (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        _names = await _load_formation_names(session, args.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        model = await session.get(GeologicalModelOrm, args.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)
        project = await ProjectRepository(session).get_by_id(model.app_project_id)
        seg = (project.view_state or {}).get("litho_segmenter") or {}
        snap_tol = float(seg.get("litho_snap_tolerance_m") or 0.20)
        h = (
            args.horizontal
            if args.horizontal is not None
            else float(seg.get("voxel_horizontal_spacing_m") or 2.0)
        )
        v = (
            args.vertical
            if args.vertical is not None
            else float(seg.get("voxel_vertical_spacing_m") or h)
        )

    sections, _ph, _pv = _load_payload(args.payload)
    inv_columns = _investigation_columns_from_picks(picks)
    columns = _authored_columns(picks)
    print(
        f"  payload {len(sections)} sections | {len(inv_columns)} honored columns | "
        f"{len(geo_surfaces)} geo surfaces | snap_tol={snap_tol} | grid {h} m / {v} m"
    )

    positions = tuple((c.investigation_id, c.world_x, c.world_y) for c in inv_columns)

    results: dict[str, dict] = {}
    for name, extra in (("BEFORE", ()), ("AFTER", positions)):
        t0 = time.perf_counter()
        domain = build_domain_from_sections(sections, investigation_positions=extra)
        grid = label_voxels(
            domain,
            h,
            sections,
            vertical_spacing_m=v,
            investigation_columns=inv_columns,
            geo_surfaces=geo_surfaces,
            litho_snap_tolerance_m=snap_tol,
        )
        meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
        res = _score(columns, meshes)
        res["bodies"] = len(meshes)
        res["tris"] = sum(len(m.triangles) for m in meshes)
        results[name] = res
        _summarise(name, res, time.perf_counter() - t0, (len(grid.gx), len(grid.gy), len(grid.gz)))
        print(f"    bodies={len(meshes)}  triangles={res['tris']:,}")

    b, a = results["BEFORE"], results["AFTER"]
    print("\n  === DELTA (AFTER - BEFORE) ===")
    for key in ("covered", "uncovered", "exact", "subsequence", "wrong"):
        print(f"    {key:22s}: {b[key]:3d} -> {a[key]:3d}   ({a[key] - b[key]:+d})")
    print(f"    {'bodies':22s}: {b['bodies']:3d} -> {a['bodies']:3d}")
    print(f"    {'triangles':22s}: {b['tris']:,} -> {a['tris']:,}")
    print(f"    still uncovered AFTER : {a['uncovered_ids']}")
    print(f"    still wrong AFTER     : {a['wrong_ids']}")

    print("\n=== A/B COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
