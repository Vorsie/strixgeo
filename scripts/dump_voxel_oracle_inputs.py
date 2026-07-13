"""Read-only dump of one litho model's raw inputs for the voxel-oracle capture.

Produces the ``voxel_oracle_inputs.json`` consumed by
``desktop/scripts/captureVoxelOracle.ts`` (which reconstructs the exact
``FenceSectionInput[]`` the renderer builds, runs ``buildVoxelRequest``, and
writes ``tests/fixtures/voxel/teststrix_partitions.json`` — the backend voxel
builder's real-data oracle).

The output field names match the DB columns 1:1 (see
``desktop/scripts/voxel_oracle_inputs.README.md``):

* ``investigations`` — every project CPT + borehole (id, location_x, location_y,
  elevation_m).
* ``litho_layers`` — every litho layer of the model (id, cpt_id, borehole_id,
  formation_id, body_id, depth_top_m, depth_base_m, status).
* ``sections`` — every project cross-section (endpoints, projection_buffer_m,
  the two exclusion id sets).
* ``edges_by_section`` — approved-or-not correlation edges keyed by section id.

This script is STRICTLY READ-ONLY (only SELECTs).  A guard aborts when the DB is
not the dev ``groundmodel`` DB, mirroring ``eval_strat_fidelity.py`` — an
accidental run against an integration/test sibling must never touch it.

Usage
-----
    uv run python scripts/dump_voxel_oracle_inputs.py
    uv run python scripts/dump_voxel_oracle_inputs.py --model-id <uuid> \
        --out desktop/scripts/voxel_oracle_inputs.json --grid-spacing 2.0
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (  # noqa: E402
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402

# Owner's known real lithostratigraphic model on the dev DB.
_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_OUT = _REPO_ROOT / "desktop" / "scripts" / "voxel_oracle_inputs.json"
_DEFAULT_GRID_SPACING_M = 2.0


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT when it is not the dev ``groundmodel`` DB.

    Read-only by design, but the guard mirrors ``eval_strat_fidelity.py`` so an
    accidental write path could never mutate an integration/test sibling.

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


async def _dump(model_id: UUID, grid_spacing_m: float) -> dict[str, Any]:
    """Build the raw-inputs document for ``model_id``.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic model to dump.
    grid_spacing_m : float
        Voxel grid spacing recorded on the document (overridable downstream).

    Returns
    -------
    dict
        The raw-inputs document (JSON-serialisable).
    """
    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {model_id} not found.")
        project_id = model.app_project_id
        print(f"  model={model_id} project={project_id}")

        # --- investigations: project CPTs + boreholes ---
        cpts = (
            await session.execute(
                select(CptOrm.id, CptOrm.location_x, CptOrm.location_y, CptOrm.elevation_m).where(
                    CptOrm.app_project_id == project_id
                )
            )
        ).all()
        boreholes = (
            await session.execute(
                select(
                    BoreholeOrm.id,
                    BoreholeOrm.location_x,
                    BoreholeOrm.location_y,
                    BoreholeOrm.elevation_m,
                ).where(BoreholeOrm.app_project_id == project_id)
            )
        ).all()
        investigations = [
            {
                "id": str(row.id),
                "location_x": float(row.location_x),
                "location_y": float(row.location_y),
                "elevation_m": (None if row.elevation_m is None else float(row.elevation_m)),
            }
            for row in (*cpts, *boreholes)
        ]

        # --- litho layers of the model ---
        layer_rows = (
            (await session.execute(select(LithoLayerOrm).where(LithoLayerOrm.model_id == model_id)))
            .scalars()
            .all()
        )
        litho_layers = [
            {
                "id": str(r.id),
                "cpt_id": (None if r.cpt_id is None else str(r.cpt_id)),
                "borehole_id": (None if r.borehole_id is None else str(r.borehole_id)),
                "formation_id": str(r.formation_id),
                "body_id": (None if r.body_id is None else str(r.body_id)),
                "depth_top_m": float(r.depth_top_m),
                "depth_base_m": float(r.depth_base_m),
                "status": r.status,
            }
            for r in layer_rows
        ]

        # --- project cross-sections ---
        section_rows = (
            (
                await session.execute(
                    select(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        sections = [
            {
                "id": str(s.id),
                "start_x": float(s.start_x),
                "start_y": float(s.start_y),
                "end_x": float(s.end_x),
                "end_y": float(s.end_y),
                "projection_buffer_m": float(s.projection_buffer_m),
                "excluded_cpt_ids": [str(i) for i in (s.excluded_cpt_ids or [])],
                "excluded_borehole_ids": [str(i) for i in (s.excluded_borehole_ids or [])],
            }
            for s in section_rows
        ]

        # --- correlation edges of the model, grouped by section ---
        edge_rows = (
            (
                await session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == model_id
                    )
                )
            )
            .scalars()
            .all()
        )
        edges_by_section: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for e in edge_rows:
            edges_by_section[str(e.section_id)].append(
                {
                    "layer_a_id": str(e.layer_a_id),
                    "layer_b_id": str(e.layer_b_id),
                    "user_approved": bool(e.user_approved),
                }
            )

    approved = sum(1 for lst in edges_by_section.values() for e in lst if e["user_approved"])
    print(
        f"  dumped {len(investigations)} investigations, {len(litho_layers)} litho layers, "
        f"{len(sections)} sections, {len(edge_rows)} edges ({approved} approved)"
    )
    return {
        "grid_spacing_m": grid_spacing_m,
        "investigations": investigations,
        "litho_layers": litho_layers,
        "sections": sections,
        "edges_by_section": dict(edges_by_section),
    }


async def main() -> None:
    """Dump the raw inputs and write the JSON document."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--out", type=Path, default=_DEFAULT_OUT)
    ap.add_argument("--grid-spacing", type=float, default=_DEFAULT_GRID_SPACING_M)
    args = ap.parse_args()

    print("\n=== VOXEL ORACLE RAW-INPUTS DUMP (READ-ONLY) ===\n")
    _confirm_db_target()

    doc = await _dump(args.model_id, args.grid_spacing)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"\n  wrote {args.out}")
    print("\n=== DUMP COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
