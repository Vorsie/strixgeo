"""READ-ONLY: reconstruct the litho segments the STORED geotech bands imply.

Every geotech band carries a formation whose ``source_litho_formation_id`` /
``source_geo_formation_id`` name the geo-bounded litho segment it subdivides.
Consecutive bands sharing that pair therefore reconstruct the segment window that
existed **when the bands were written**, top and base included — the segmenter
always clamps its outermost bands to the segment bounds.

Comparing that reconstruction against the segments today's litho model produces
says whether the litho input moved under the geotech model.  Only SELECTs are
issued, behind the dev-DB guard.

Usage
-----
    uv run python scripts/diag_geotech_implied_litho_segments.py
    uv run python scripts/diag_geotech_implied_litho_segments.py --show-all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies  # noqa: E402
from groundmodel.domain.services.litho_geo_bounding import (  # noqa: E402
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402


def _mm(x: float) -> int:
    """Millimetre key for a depth."""
    return int(round(x * 1000.0))


async def main() -> None:
    """Reconstruct the write-time segments and diff them against today's."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--show-all", action="store_true", help="Print matching columns too.")
    args = parser.parse_args()

    print("\n=== SEGMENTS IMPLIED BY THE STORED GEOTECH BANDS vs TODAY'S (READ-ONLY) ===\n")
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
        assert litho_model is not None and litho_model_id is not None

        use_case = SubdivideAllBodies(session)
        snap_tol = await use_case._read_geotech_snap_tolerance_m(geotech.app_project_id)
        picks = await use_case._litho_repo.load_body_picks(litho_model_id)
        geo_surfaces = await use_case._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        shallow = mark_and_truncate_shallow_tests(
            picks, use_case._make_lowest_boundary_sampler(geo_surfaces)
        )
        divided = divide_picks_by_geology(
            shallow.picks, use_case._make_boundary_sampler(geo_surfaces), snap_tol
        )

        # Today's segments per investigation, with their (litho fid, geo fid) key.
        today: dict[str, list[tuple[float, float, UUID, UUID | None]]] = {}
        for seg in divided:
            geo_fid = use_case._geo_formation_at_midpoint(seg, geo_surfaces)
            today.setdefault(seg.investigation_id, []).append(
                (seg.top_depth_m, seg.base_depth_m, UUID(seg.formation_id), geo_fid)
            )
        for segs in today.values():
            segs.sort(key=lambda s: s[0])

        # Stored geotech bands with their source-litho / source-geo attribution.
        rows = (
            await session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.source_litho_formation_id,
                    GeologicalFormationOrm.source_geo_formation_id,
                    GeologicalFormationOrm.nad_class,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(
                    LithoLayerOrm.model_id == geotech.id,
                    LithoLayerOrm.cpt_id.is_not(None),
                )
            )
        ).all()
        stored: dict[str, list[Any]] = {}
        for r in rows:
            stored.setdefault(str(r.cpt_id), []).append(r)
        for bands in stored.values():
            bands.sort(key=lambda b: b.depth_top_m)

        soil_by_fid = {
            f.id: f.litho_main_soil_code
            for f in (await session.execute(select(GeologicalFormationOrm))).scalars().all()
        }
        name_by_id = {str(c.id): c.name for c in (await session.execute(select(CptOrm))).scalars()}

        mismatched = 0
        for cid in sorted(stored, key=lambda i: name_by_id.get(i, "")):
            bands = stored[cid]
            implied: list[tuple[float, float, UUID, UUID | None]] = []
            for b in bands:
                key = (b.source_litho_formation_id, b.source_geo_formation_id)
                if implied and (implied[-1][2], implied[-1][3]) == key:
                    implied[-1] = (implied[-1][0], b.depth_base_m, key[0], key[1])
                else:
                    implied.append((b.depth_top_m, b.depth_base_m, key[0], key[1]))

            now = today.get(cid, [])
            same = [(_mm(t), _mm(bs), f, g) for t, bs, f, g in implied] == [
                (_mm(t), _mm(bs), f, g) for t, bs, f, g in now
            ]
            if same and not args.show_all:
                continue
            if not same:
                mismatched += 1
            print(f"--- {name_by_id.get(cid, cid)} ---   segments identical: {same}")
            n = max(len(implied), len(now))
            for i in range(n):
                im = implied[i] if i < len(implied) else None
                nw = now[i] if i < len(now) else None
                eq = (
                    im is not None
                    and nw is not None
                    and (_mm(im[0]), _mm(im[1]), im[2], im[3])
                    == (_mm(nw[0]), _mm(nw[1]), nw[2], nw[3])
                )
                print(
                    f"   {'  ' if eq else '!!'} implied "
                    + (
                        f"{im[0]:9.6f}-{im[1]:9.6f} {str(soil_by_fid.get(im[2])):5s}"
                        if im
                        else f"{'-':25s}"
                    )
                    + "   today "
                    + (f"{nw[0]:9.6f}-{nw[1]:9.6f} {str(soil_by_fid.get(nw[2])):5s}" if nw else "-")
                )
            print()
        print(f"  columns whose geo-bounded segments MOVED since the geotech write: {mismatched}")


if __name__ == "__main__":
    asyncio.run(main())
