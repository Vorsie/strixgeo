"""Explain WHERE a borehole's planned packing splits come from.

Read-only. Replicates ``DivideBoreholes._plan_borehole_bands_litho_confined``
steps 1-3 for ONE named borehole and prints, per body group and per transition
surface: the contributing CPTs (name, map distance to the borehole), each
control point's boundary elevation, whether the split came from a TIN or the
flat-mean fallback, and the resulting split elevation at the borehole.

Born 2026-08-04 from the owner's dogfeed question "I'd expect the dense sand to
be higher at 1411-GEO-23/126-B4 — is the alongM right?" (alongM is not
involved; the planner interpolates in map XY). The two candidate mechanisms
this script separates:

* ordinal transition matching — ``transition_surfaces[k]`` blends the k-th
  boundary of every CPT, which is only one geological surface when every CPT
  in the group carries the same band sequence;
* the <3-control-points / outside-TIN-footprint flat-mean fallback.

Usage::

    uv run python scripts/diag_divide_borehole_explain.py "126-B4"

The argument is a case-insensitive substring of the borehole name.
"""

from __future__ import annotations

import asyncio
import math
import sys
from collections import defaultdict
from uuid import UUID

from sqlalchemy import select

sys.path.insert(0, "src")

from groundmodel.application.divide_boreholes import (  # noqa: E402
    _DEPTH_OVERLAP_EPS,
)
from groundmodel.domain.services.geotech_split_surface import (  # noqa: E402
    ColumnXY,
    interpolate_split_elevations,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402


async def main(name_fragment: str) -> None:
    """Run the explanation for the first borehole whose name matches."""
    async with AsyncSessionFactory() as session:
        bh_row = (
            await session.execute(
                select(
                    BoreholeOrm.id,
                    BoreholeOrm.name,
                    BoreholeOrm.location_x,
                    BoreholeOrm.location_y,
                    BoreholeOrm.elevation_m,
                    BoreholeOrm.app_project_id,
                ).where(BoreholeOrm.name.ilike(f"%{name_fragment}%"))
            )
        ).first()
        if bh_row is None:
            print(f"no borehole matching {name_fragment!r}")
            return
        bh_id, bh_name, bh_x, bh_y, bh_elev, project_id = bh_row
        print(f"borehole {bh_name} ({bh_id})  xy=({bh_x:.1f},{bh_y:.1f})  surf={bh_elev:.2f} m")

        models = (
            await session.execute(
                select(GeologicalModelOrm.id, GeologicalModelOrm.kind).where(
                    GeologicalModelOrm.app_project_id == project_id,
                    GeologicalModelOrm.kind.in_(["lithostratigraphic", "geotechnical"]),
                )
            )
        ).all()
        litho_id = next((m.id for m in models if m.kind == "lithostratigraphic"), None)
        geotech_id = next((m.id for m in models if m.kind == "geotechnical"), None)
        if litho_id is None or geotech_id is None:
            print(f"missing models: litho={litho_id} geotech={geotech_id}")
            return

        # Ground truth first: the REAL planner's bands for this borehole. The
        # contributor replica below is only trusted where its split elevations
        # reproduce these boundaries.
        from groundmodel.application.divide_boreholes import DivideBoreholes

        real_plan = await DivideBoreholes(session).plan(
            project_id=project_id, litho_model_id=litho_id
        )
        for seg in real_plan.segments:
            if seg.investigation_id != str(bh_id):
                continue
            print("  REAL plan bands:")
            for b in seg.bands:
                print(
                    f"    {b.depth_top_m:6.2f}-{b.depth_base_m:6.2f} m "
                    f"(elev {bh_elev - b.depth_top_m:6.2f}..{bh_elev - b.depth_base_m:6.2f}) "
                    f"NAD {b.nad_class}  {b.source}/{b.confidence}"
                )

        repo = LithoLayerRepository(session)
        picks = await repo.load_body_picks(str(litho_id))

        # Contributor replica: grouped by body_id ONLY (the real plan also
        # splits by geo formation via divide_picks_by_geology — where that
        # matters the replica's splits will NOT reproduce the real bands, and
        # the mismatch is printed rather than hidden).
        groups: dict[str, list] = defaultdict(list)
        for p in picks:
            groups[str(p.body_id)].append(p)

        # Geotech CPT layers keyed by investigation, like plan()'s index.
        geo_picks = await repo.load_body_picks(str(geotech_id))
        geotech_by_inv: dict[str, list] = defaultdict(list)
        for gp in geo_picks:
            geotech_by_inv[gp.investigation_id].append(gp)

        cpt_rows = (
            await session.execute(
                select(
                    CptOrm.id, CptOrm.name, CptOrm.location_x, CptOrm.location_y, CptOrm.elevation_m
                ).where(CptOrm.app_project_id == project_id)
            )
        ).all()
        cpt_info = {str(c.id): c for c in cpt_rows}

        # Formation id -> name, loaded once (an await inside a join() genexp is
        # an async generator, not an iterable).
        f_rows = (
            await session.execute(select(GeologicalFormationOrm.id, GeologicalFormationOrm.name))
        ).all()
        fname_by_id = {str(fr.id): fr.name for fr in f_rows}

        bh_id_str = str(bh_id)
        for body_id_str, segs in groups.items():
            bh_segs = [s for s in segs if s.investigation_id == bh_id_str]
            if not bh_segs:
                continue
            cpt_segs = [s for s in segs if s.investigation_id in cpt_info]
            formation = await session.get(GeologicalFormationOrm, segs[0].formation_id)
            fname = formation.name if formation else "?"
            soil = formation.litho_main_soil_code if formation else "?"
            print(f"\n=== body group body={body_id_str[:8]} litho={fname} soil={soil} ===")
            for bh_seg in bh_segs:
                print(
                    f"  borehole extent {bh_seg.top_depth_m:.2f}-{bh_seg.base_depth_m:.2f} m "
                    f"(elev {bh_elev - bh_seg.top_depth_m:.2f} .. "
                    f"{bh_elev - bh_seg.base_depth_m:.2f})"
                )

            # Step 1+2 replica: per-CPT in-extent geotech stacks.
            transition_surfaces: list[list[tuple[ColumnXY, float, str, str]]] = []
            for cpt_seg in cpt_segs:
                inv = cpt_seg.investigation_id
                c = cpt_info[inv]
                in_extent = sorted(
                    (
                        g
                        for g in geotech_by_inv.get(inv, [])
                        if g.top_depth_m >= cpt_seg.top_depth_m - _DEPTH_OVERLAP_EPS
                        and g.base_depth_m <= cpt_seg.base_depth_m + _DEPTH_OVERLAP_EPS
                    ),
                    key=lambda g: g.top_depth_m,
                )
                if not in_extent:
                    continue
                dist = math.hypot(c.location_x - bh_x, c.location_y - bh_y)
                surf = c.elevation_m or 0.0
                stack = " | ".join(
                    f"{fname_by_id.get(str(g.formation_id), '?')}"
                    f" {surf - g.top_depth_m:.2f}..{surf - g.base_depth_m:.2f}"
                    for g in in_extent
                )
                print(f"  CPT {c.name}  dist={dist:.1f} m  stack: {stack}")
                col = ColumnXY(investigation_id=inv, x_m=c.location_x, y_m=c.location_y)
                for k, g in enumerate(in_extent):
                    if k < len(in_extent) - 1:
                        pair = (
                            f"{fname_by_id.get(str(g.formation_id), '?')}->"
                            f"{fname_by_id.get(str(in_extent[k + 1].formation_id), '?')}"
                        )
                        while len(transition_surfaces) <= k:
                            transition_surfaces.append([])
                        transition_surfaces[k].append((col, surf - g.base_depth_m, c.name, pair))

            # Step 3 replica: interpolate each ordinal transition at the borehole.
            bh_col = ColumnXY(investigation_id=bh_id_str, x_m=bh_x, y_m=bh_y)
            for k, ctrl in enumerate(transition_surfaces):
                if not ctrl:
                    continue
                pts = [c for c, _, _, _ in ctrl]
                elevs = [e for _, e, _, _ in ctrl]
                mode = "TIN" if len(pts) >= 3 else f"MEAN({len(pts)} pts)"
                got = interpolate_split_elevations(pts, elevs, [bh_col])[bh_id_str]
                mean = sum(elevs) / len(elevs)
                tinflat = (
                    " (TIN returned the mean -> outside footprint?)"
                    if (len(pts) >= 3 and abs(got - mean) < 1e-9)
                    else ""
                )
                pairs = {p for _, _, _, p in ctrl}
                pairnote = "" if len(pairs) == 1 else f"  !! ORDINAL MIXES {sorted(pairs)}"
                print(
                    f"  transition k={k} [{mode}] -> elev {got:.2f} at borehole{tinflat}{pairnote}"
                )
                for _, e, cname, pair in ctrl:
                    print(f"     ctrl {cname:24s} {pair:22s} elev {e:.2f}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "126-B4"))
