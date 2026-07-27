"""READ-ONLY experiment: three model-footprint variants, timed and scored.

The footprint fix (cover the investigations' TRUE drilled positions, not only
the section columns' projected feet) closes every uncovered column, but it also
re-tunes the alpha hull: ``alpha_hull_polygon`` derives its tightness from the
MEDIAN Delaunay edge length, so adding 58 more points makes the hull less
concave everywhere, not just around the boreholes that were outside it.  This
script measures whether that global re-tuning is worth its cost, by running
three variants on identical inputs:

* ``A feet-only``      — the behaviour before the fix.
* ``B all-drilled``    — every honored investigation's true position joins the
  hull inputs (the straightforward fix).
* ``C outside-only``   — only the drilled positions that variant A's footprint
  REJECTS join the hull inputs, so the hull is widened exactly where it has to
  be and the alpha tightness barely moves.

For each variant it reports hull area, labelled-column count, the LABEL and
EXTRACT wall-clocks separately (the on-click Build's cost), and the fidelity
verdicts scored with ``eval_strat_fidelity``'s own functions.

Nothing is persisted; the DB is only read, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_voxel_footprint_variants.py
"""

from __future__ import annotations

import argparse
import asyncio
import math
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
from scripts.diag_voxel_fidelity_delta import _score  # noqa: E402
from scripts.diag_voxel_label_columns import _load_payload  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _confirm_db_target,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_v2_voxel_payload.json"


def _ring_area_ha(polygon) -> float:
    """Return a closed ring's shoelace area in hectares.

    Parameters
    ----------
    polygon : sequence of (float, float)
        The hull ring (no repeated last vertex).

    Returns
    -------
    float
        Area in hectares.
    """
    r = np.asarray(polygon, dtype=float)
    x, y = r[:, 0], r[:, 1]
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0) / 1e4


async def main() -> None:
    """Run the three footprint variants and print the comparison table."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--payload", type=Path, default=_DEFAULT_PAYLOAD)
    args = ap.parse_args()

    print("\n=== VOXEL FOOTPRINT VARIANTS (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        model = await session.get(GeologicalModelOrm, args.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)
        project = await ProjectRepository(session).get_by_id(model.app_project_id)
        seg = (project.view_state or {}).get("litho_segmenter") or {}
        snap_tol = float(seg.get("litho_snap_tolerance_m") or 0.20)
        h = float(seg.get("voxel_horizontal_spacing_m") or 2.0)
        v = float(seg.get("voxel_vertical_spacing_m") or h)

    sections, _ph, _pv = _load_payload(args.payload)
    inv_columns = _investigation_columns_from_picks(picks)
    columns = _authored_columns(picks)
    all_drilled = tuple((c.investigation_id, c.world_x, c.world_y) for c in inv_columns)

    # Variant C's input: the drilled positions the feet-only footprint rejects.
    feet_only = build_domain_from_sections(sections)
    tol = 0.5 * h * math.sqrt(2.0)
    outside_only = tuple(p for p in all_drilled if not feet_only.contains(p[1], p[2], tol=tol))
    print(
        f"  grid {h} m / {v} m | {len(inv_columns)} honored columns | "
        f"{len(outside_only)} of them outside the feet-only footprint"
    )

    variants = (
        ("A feet-only", ()),
        ("B all-drilled", all_drilled),
        ("C outside-only", outside_only),
    )
    for name, extra in variants:
        domain = build_domain_from_sections(sections, investigation_positions=extra)
        ring = np.asarray(domain.polygon, dtype=float)
        gx = np.arange(ring[:, 0].min(), ring[:, 0].max() + h / 2, h)
        gy = np.arange(ring[:, 1].min(), ring[:, 1].max() + h / 2, h)
        labelled_cols = sum(
            1 for xi in gx for yj in gy if domain.contains(float(xi), float(yj), tol=tol)
        )

        t0 = time.perf_counter()
        grid = label_voxels(
            domain,
            h,
            sections,
            vertical_spacing_m=v,
            investigation_columns=inv_columns,
            geo_surfaces=geo_surfaces,
            litho_snap_tolerance_m=snap_tol,
        )
        t_label = time.perf_counter() - t0

        t0 = time.perf_counter()
        meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
        t_extract = time.perf_counter() - t0

        res = _score(columns, meshes)
        errs = sorted(res["depth_errors"])
        print(f"\n  --- {name} ---")
        print(
            f"    hull {len(ring)} verts, {_ring_area_ha(domain.polygon):.2f} ha | "
            f"bbox {len(gx)}x{len(gy)} | labelled columns {labelled_cols:,}"
        )
        print(
            f"    label {t_label:7.1f}s | extract {t_extract:6.1f}s | "
            f"TOTAL {t_label + t_extract:7.1f}s"
        )
        print(
            f"    covered {res['covered']}/58 | uncovered {res['uncovered']} {res['uncovered_ids']}"
        )
        print(
            f"    exact {res['exact']} | subsequence {res['subsequence']} | "
            f"wrong {res['wrong']} {res['wrong_ids']}"
        )
        print(
            f"    bodies {len(meshes)} | tris {sum(len(m.triangles) for m in meshes):,} | "
            f"contact err median={np.median(errs):.3f} p90={np.percentile(errs, 90):.3f} "
            f"max={errs[-1]:.3f}"
        )

    print("\n=== VARIANTS COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
