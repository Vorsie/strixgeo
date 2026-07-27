"""READ-ONLY diagnostic: what ``label_voxels`` actually produces at each borehole.

Evidence instrument for the two open voxel-fidelity bugs (B = uncovered
columns, C = mislabelled columns).  Where ``scripts/eval_strat_fidelity.py``
scores the PERSISTED meshes, this script re-runs the labelling stage itself on
the SAME inputs and prints, per investigation:

* the grid cell ``(i, j)`` its true ``(x, y)`` maps to,
* whether the domain footprint admits that cell (the ``domain.contains`` gate
  that skips a column entirely),
* whether the investigation won its honor cell (``label_voxels`` honors at most
  ONE investigation per ``(i, j)`` — lexicographically smallest id wins),
* the labelled voxel column collapsed to a formation sequence, and
* the authored (drilled) sequence, side by side.

That separates the candidate causes without guessing: a column that is void in
the LABEL grid is a labelling bug; a column that is filled in the label grid but
missing from the persisted meshes is a stale-build / extraction issue; a column
whose labels disagree with its own log is an honor bug.

Inputs
------
The 2-D partition payload is NOT stored in the DB (the frontend owns it), so it
is supplied as a captured JSON payload (``--payload``), produced by running
``desktop/scripts/captureVoxelOracle.ts`` against
``scripts/dump_voxel_oracle_inputs.py`` output with the SAME partition engine
the owner's build used.  The picks, geological surfaces and snap tolerance come
from the dev DB, exactly as ``BuildVoxelLithoModel`` reads them.

Regenerating the payload
------------------------
1. ``uv run python scripts/dump_voxel_oracle_inputs.py`` — writes
   ``desktop/scripts/voxel_oracle_inputs.json`` from the dev DB.
2. ``cd desktop && npx tsx scripts/captureVoxelOracle.ts`` — writes
   ``tests/fixtures/voxel/teststrix_partitions.json``.  Set
   ``STRIX_PARTITION_V2=1`` first when the build being diagnosed used the v2
   closed-loop partition engine (the env override in ``partitionEngineSelect``);
   without it the capture silently uses v1 and the diagnosis is of a payload the
   owner's build never saw.
3. Copy that file aside (step 2 overwrites the COMMITTED v1 oracle — restore it
   with ``git checkout -- tests/fixtures/voxel/teststrix_partitions.json``) and
   pass the copy as ``--payload``.

If ``tsx`` is not installed, step 2 can be run through the already-installed
vitest by importing ``scripts/captureVoxelOracle`` (its ``main()`` executes on
import) from a temporary spec — remember to delete that spec afterwards, or
``npm test`` will overwrite the committed oracle on every run.

Verifying the payload is the right one: run
``scripts/diag_voxel_fidelity_delta.py``; its ``BEFORE`` arm must reproduce the
PERSISTED build's fidelity numbers exactly.  If it does not, the payload is not
what the persisted solids were built from and nothing downstream is trustworthy.

STRICTLY READ-ONLY (only SELECTs), with the dev-DB guard of
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/diag_voxel_label_columns.py \
        --payload scripts/throwaway_v2_voxel_payload.json
    uv run python scripts/diag_voxel_label_columns.py --only 9602,7c4b
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
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
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
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
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
    _load_solids,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_v2_voxel_payload.json"


def _slug(inv_id: str) -> str:
    """Return the 4-hex-char shorthand the owner's notes use for an investigation.

    Parameters
    ----------
    inv_id : str
        Full investigation UUID string.

    Returns
    -------
    str
        The second UUID group (e.g. ``"7c4b"``).
    """
    parts = inv_id.split("-")
    return parts[1] if len(parts) > 1 else inv_id[:4]


def _load_payload(path: Path) -> tuple[list[SectionPartitionInput], float, float]:
    """Parse a captured ``VoxelBuildRequest`` JSON into domain value objects.

    Parameters
    ----------
    path : Path
        The captured payload file.

    Returns
    -------
    tuple[list[SectionPartitionInput], float, float]
        The sections, the horizontal spacing and the vertical spacing (metres).
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    sections: list[SectionPartitionInput] = []
    for s in raw["sections"]:
        sections.append(
            SectionPartitionInput(
                start_x=float(s["start_x"]),
                start_y=float(s["start_y"]),
                end_x=float(s["end_x"]),
                end_y=float(s["end_y"]),
                columns=tuple(
                    SectionColumnInput(
                        investigation_id=c["investigation_id"],
                        along_m=float(c["along_m"]),
                        world_x=float(c["world_x"]),
                        world_y=float(c["world_y"]),
                    )
                    for c in s["columns"]
                ),
                regions=tuple(
                    RegionInput(
                        formation_id=r["formation_id"],
                        body_id=r["body_id"],
                        polygon=tuple((float(p[0]), float(p[1])) for p in r["polygon"]),
                        gap_index=int(r["gap_index"]),
                    )
                    for r in s["regions"]
                ),
            )
        )
    h = float(raw.get("horizontal_spacing_m") or raw.get("grid_spacing_m") or 2.0)
    v = float(raw.get("vertical_spacing_m") or h)
    return sections, h, v


def _collapse(
    labels: np.ndarray, gz: np.ndarray, grid, names: dict[str, str]
) -> list[tuple[str, float, float]]:
    """Collapse a labelled voxel column into ``(formation_label, top, base)`` runs.

    Consecutive voxels carrying the same FORMATION merge into one run; a void
    voxel (``-1``) breaks the run and is reported as ``"(void)"``.

    Parameters
    ----------
    labels : numpy.ndarray
        Shape ``(nz,)`` int32 body indices for one column (``-1`` = void).
    gz : numpy.ndarray
        The ascending Z node coordinates.
    grid : LabelGrid
        The labelled grid (for ``body_id_by_index`` / ``formation_by_body``).
    names : dict[str, str]
        ``formation_id`` → display label.

    Returns
    -------
    list[tuple[str, float, float]]
        Runs ordered top → bottom as ``(label, top_elev, base_elev)``.
    """
    runs: list[tuple[str, float, float]] = []
    cur_label: str | None = None
    cur_top = 0.0
    cur_base = 0.0
    for k in range(len(gz) - 1, -1, -1):  # shallow → deep
        idx = int(labels[k])
        if idx < 0:
            label = "(void)"
        else:
            bid = grid.body_id_by_index[idx]
            fid = grid.formation_by_body.get(bid, bid)
            label = names.get(fid, fid[:8])
        top = float(gz[k])
        if label == cur_label:
            cur_base = top
        else:
            if cur_label is not None:
                runs.append((cur_label, cur_top, cur_base))
            cur_label = label
            cur_top = top
            cur_base = top
    if cur_label is not None:
        runs.append((cur_label, cur_top, cur_base))
    return runs


async def main() -> None:
    """Run the per-column labelling diagnostic and print the evidence blocks."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--payload", type=Path, default=_DEFAULT_PAYLOAD)
    ap.add_argument("--only", type=str, default="", help="comma-separated investigation slugs")
    args = ap.parse_args()

    print("\n=== VOXEL LABEL-COLUMN DIAGNOSTIC (READ-ONLY) ===\n")
    _confirm_db_target()

    only = {s.strip() for s in args.only.split(",") if s.strip()}

    async with AsyncSessionFactory() as session:
        names = await _load_formation_names(session, args.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        solids = await _load_solids(session, args.model_id)
        model = await session.get(GeologicalModelOrm, args.model_id)
        geo_surfaces = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)
        project = await ProjectRepository(session).get_by_id(model.app_project_id)
        seg = (project.view_state or {}).get("litho_segmenter") or {}
        snap_tol = float(seg.get("litho_snap_tolerance_m") or 0.20)

    sections, h, v = _load_payload(args.payload)
    print(f"  payload: {len(sections)} sections, horizontal={h} m vertical={v} m")
    print(f"  {len(picks)} picks, {len(geo_surfaces)} geo surface(s), snap_tol={snap_tol}")

    inv_columns = _investigation_columns_from_picks(picks)
    domain = build_domain_from_sections(sections)
    print(f"  domain footprint: {len(domain.polygon)}-vertex alpha hull")

    print("  labelling grid (this takes a couple of minutes)...")
    grid = label_voxels(
        domain,
        h,
        sections,
        vertical_spacing_m=v,
        investigation_columns=inv_columns,
        geo_surfaces=geo_surfaces,
        litho_snap_tolerance_m=snap_tol,
    )
    gx, gy, gz = grid.gx, grid.gy, grid.gz
    print(f"  labelled {len(gx)}x{len(gy)}x{len(gz)} grid, {len(grid.body_id_by_index)} body slots")

    # Reproduce label_voxels' own honor-cell assignment so the winner/loser of
    # each collision is read from the same rule, not re-derived by eye.
    honored_by_cell: dict[tuple[int, int], str] = {}
    for inv in inv_columns:
        if not inv.intervals:
            continue
        ci = int(np.argmin(np.abs(gx - inv.world_x)))
        cj = int(np.argmin(np.abs(gy - inv.world_y)))
        prev = honored_by_cell.get((ci, cj))
        if prev is None or inv.investigation_id < prev:
            honored_by_cell[(ci, cj)] = inv.investigation_id

    active_solids = [
        (bid, fid, verts, tris)
        for bid, fid, verts, tris, is_flagged, _s in solids
        if not is_flagged and verts and tris
    ]
    authored = {c[0]: c for c in _authored_columns(picks)}

    footprint_tol = 0.5 * h * float(np.sqrt(2.0))

    n_label_void = 0
    n_mesh_void = 0
    print("\n" + "=" * 74)
    print("  PER-COLUMN: footprint / honor / label-grid vs persisted mesh")
    print("=" * 74)
    for inv in sorted(inv_columns, key=lambda c: c.investigation_id):
        slug = _slug(inv.investigation_id)
        if only and slug not in only:
            continue
        x, y = inv.world_x, inv.world_y
        ci = int(np.argmin(np.abs(gx - x)))
        cj = int(np.argmin(np.abs(gy - y)))
        inside = domain.contains(float(gx[ci]), float(gy[cj]), tol=footprint_tol)
        winner = honored_by_cell.get((ci, cj))
        is_winner = winner == inv.investigation_id
        col = grid.labels[ci, cj, :]
        label_filled = bool((col >= 0).any())
        mesh_stack = _compute_model_stack(x, y, active_solids)
        if not label_filled:
            n_label_void += 1
        if not mesh_stack:
            n_mesh_void += 1
        flag = ""
        if not label_filled:
            flag = "  <<< LABEL-GRID VOID"
        elif not mesh_stack:
            flag = "  <<< LABELLED BUT NO PERSISTED MESH"
        print(
            f"\n  {slug}  ({x:.2f}, {y:.2f})  cell=({ci},{cj})  "
            f"node=({gx[ci]:.2f},{gy[cj]:.2f})  contains={'Y' if inside else 'N'}  "
            f"honor={'WIN' if is_winner else 'LOST->' + (_slug(winner) if winner else '-')}"
            f"  label_filled={'Y' if label_filled else 'N'}"
            f"  mesh_hit={'Y' if mesh_stack else 'N'}{flag}"
        )
        if only:
            auth = authored[inv.investigation_id][3]
            print("      AUTHORED (drilled):")
            for fid, top, base in auth:
                print(f"        {names.get(fid, fid[:8]):8s} top={top:8.3f} base={base:8.3f}")
            print("      LABEL GRID (voxel column):")
            for lab, top, base in _collapse(col, gz, grid, names):
                print(f"        {lab:8s} top={top:8.3f} base={base:8.3f}")
            print("      PERSISTED MESH (ray at true x,y):")
            for fid, base, top in mesh_stack:
                print(f"        {names.get(fid, fid[:8]):8s} top={top:8.3f} base={base:8.3f}")

    print("\n" + "=" * 74)
    print(
        f"  SUMMARY: {n_label_void} column(s) void in the LABEL GRID; "
        f"{n_mesh_void} column(s) with no PERSISTED MESH hit."
    )
    print("=" * 74)
    print("\n=== DIAGNOSTIC COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
