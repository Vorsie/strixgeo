"""READ-ONLY: the litho picks under the two disagreeing geotech columns, with times.

Companion to ``diag_geotech_subdivision_determinism.py``.  That script showed the
pure segmenter reproduces the NEW bands from dev data, so the stored bands came
from a different INPUT.  The differing boundaries turned out to be geo-bounded
SEGMENT edges, not within-segment split edges, so the suspect input is the litho
layer stack (or the geology that bounds it).

This prints, per investigation: every accepted ``litho_layer`` with its soil code
and its ``created_at`` / ``updated_at``, the geo-bounded segments derived from
them, and the geological surfaces' build timestamps — next to the moment the
geotech bands were written.  Only SELECTs are issued, behind the dev-DB guard.

Usage
-----
    uv run python scripts/diag_geotech_litho_input_timeline.py
    uv run python scripts/diag_geotech_litho_input_timeline.py --name S17 --name S9
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import func, select  # noqa: E402

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.formation_surface_orm import (  # noqa: E402
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

_DEFAULT_NAMES = ("GEO-23/125-S17", "GEO-23/125-S9")


async def main() -> None:
    """Print the litho input stack + timestamps for the named columns."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", action="append", default=None)
    args = parser.parse_args()
    wanted = args.name or list(_DEFAULT_NAMES)

    print("\n=== LITHO INPUT TIMELINE UNDER THE GEOTECH BANDS (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        geotech = (
            (
                await session.execute(
                    select(GeologicalModelOrm).where(GeologicalModelOrm.kind == "geotechnical")
                )
            )
            .scalars()
            .one()
        )
        litho_model_id = geotech.parent_model_id
        litho_model = await session.get(GeologicalModelOrm, litho_model_id)
        assert litho_model is not None
        geo_model_id = litho_model.parent_model_id
        print(f"  litho model {litho_model_id}   geo model {geo_model_id}\n")

        # When were the geotech bands written?
        gt_times = (
            await session.execute(
                select(
                    func.min(LithoLayerOrm.created_at),
                    func.max(LithoLayerOrm.created_at),
                    func.max(LithoLayerOrm.updated_at),
                ).where(LithoLayerOrm.model_id == geotech.id)
            )
        ).one()
        print(f"  geotech bands written  : {gt_times[0]} .. {gt_times[1]} (max upd {gt_times[2]})")

        # When was the litho model last touched, model-wide?
        li_times = (
            await session.execute(
                select(
                    func.min(LithoLayerOrm.created_at),
                    func.max(LithoLayerOrm.created_at),
                    func.max(LithoLayerOrm.updated_at),
                ).where(LithoLayerOrm.model_id == litho_model_id)
            )
        ).one()
        print(
            f"  litho layers (model-wide): {li_times[0]} .. {li_times[1]} (max upd {li_times[2]})"
        )

        # How many litho layers were touched AFTER the geotech write?
        after = (
            await session.execute(
                select(func.count())
                .select_from(LithoLayerOrm)
                .where(
                    LithoLayerOrm.model_id == litho_model_id,
                    LithoLayerOrm.updated_at > gt_times[1],
                )
            )
        ).scalar_one()
        print(f"  litho layers updated AFTER the geotech write: {after}")

        surfaces = (
            (
                await session.execute(
                    select(FormationSurfaceOrm).where(
                        FormationSurfaceOrm.model_id == geo_model_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        print(f"\n  geological surfaces ({len(surfaces)}):")
        for s in surfaces:
            print(
                f"    formation {s.formation_id} stale={s.is_stale} "
                f"verts={len(s.vertices or [])} tris={len(s.triangles or [])} "
                f"created={s.created_at} updated={s.updated_at}"
            )

        cpts = (await session.execute(select(CptOrm))).scalars().all()
        targets = [c for c in cpts if any(w in c.name for w in wanted)]
        for cpt in targets:
            rows = (
                await session.execute(
                    select(
                        LithoLayerOrm.id,
                        LithoLayerOrm.depth_top_m,
                        LithoLayerOrm.depth_base_m,
                        LithoLayerOrm.status,
                        LithoLayerOrm.source,
                        LithoLayerOrm.body_id,
                        LithoLayerOrm.created_at,
                        LithoLayerOrm.updated_at,
                        GeologicalFormationOrm.litho_main_soil_code,
                        GeologicalFormationOrm.name,
                    )
                    .join(
                        GeologicalFormationOrm,
                        LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                    )
                    .where(
                        LithoLayerOrm.model_id == litho_model_id,
                        LithoLayerOrm.cpt_id == cpt.id,
                    )
                    .order_by(LithoLayerOrm.depth_top_m)
                )
            ).all()
            print(f"\n--- {cpt.name} ({cpt.id}) — {len(rows)} litho layer(s) ---")
            print(f"    surface elev {cpt.elevation_m}  xy ({cpt.location_x}, {cpt.location_y})")
            for r in rows:
                body: Any = r.body_id
                print(
                    f"    {r.depth_top_m:9.6f} - {r.depth_base_m:9.6f}  "
                    f"{str(r.litho_main_soil_code):5s} {r.status:9s} {r.source:10s} "
                    f"body={'yes' if body else 'NONE':4s} "
                    f"created={r.created_at} updated={r.updated_at}"
                )


if __name__ == "__main__":
    asyncio.run(main())
