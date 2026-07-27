"""READ-ONLY: what would the enclosed-lens merge create if Build ran right now?

Debt #243 wires ``MergeEnclosedLensBodies`` to the litho Build button. The merge
writes correlation edges and re-stamps ``body_id``, so before the first real run
it is worth knowing exactly what it will do. This script runs the SAME planner
(:func:`plan_enclosed_lens_merges`) over the SAME per-section inputs the use case
assembles, and reports, per section, how many planned edges are net-new versus
already present in ``litho_contact_correlation_edge``.

Nothing is written. The DB is only read, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_enclosed_lens_merge_dryrun.py
    uv run python scripts/diag_enclosed_lens_merge_dryrun.py --model-id <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.project_investigations_onto_section import (  # noqa: E402
    project_investigations_onto_section,
)
from groundmodel.domain.services.plan_enclosed_lens_merges import (  # noqa: E402
    MergeLayer,
    plan_enclosed_lens_merges,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (  # noqa: E402
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Plan the merge for every section of the model and print the outcome."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    args = ap.parse_args()

    print("\n=== ENCLOSED-LENS MERGE DRY RUN (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, args.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {args.model_id} not found.")
        project_id = model.app_project_id
        print(f"  model {args.model_id} (project {project_id})\n")

        # Accepted layers + lithology — mirrors MergeEnclosedLensBodies step 1.
        layer_rows = (
            await session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.litho_main_soil_code,
                )
                .join(
                    GeologicalFormationOrm,
                    GeologicalFormationOrm.id == LithoLayerOrm.formation_id,
                )
                .where(
                    LithoLayerOrm.model_id == args.model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()

        surf: dict[UUID, float | None] = {}
        names: dict[UUID, str] = {}
        for r in (
            await session.execute(
                select(CptOrm.id, CptOrm.elevation_m, CptOrm.name).where(
                    CptOrm.app_project_id == project_id
                )
            )
        ).all():
            surf[r.id] = r.elevation_m
            names[r.id] = r.name
        for r in (
            await session.execute(
                select(BoreholeOrm.id, BoreholeOrm.elevation_m, BoreholeOrm.name).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all():
            surf[r.id] = r.elevation_m
            names[r.id] = r.name

        stacks: dict[UUID, list[MergeLayer]] = {}
        for r in layer_rows:
            inv = r.cpt_id if r.cpt_id is not None else r.borehole_id
            if inv is None or surf.get(inv) is None:
                continue
            s = float(surf[inv])  # type: ignore[arg-type]
            stacks.setdefault(inv, []).append(
                MergeLayer(
                    layer_id=r.id,
                    inv_id=inv,
                    top_elev=s - r.depth_top_m,
                    base_elev=s - r.depth_base_m,
                    soil=r.litho_main_soil_code or "",
                )
            )
        for entries in stacks.values():
            entries.sort(key=lambda u: -u.top_elev)

        # Existing edges, as the canonical unordered pair the insert dedupes on.
        existing: set[tuple[UUID, UUID]] = set()
        for a, b in (
            await session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                ).where(LithoContactCorrelationEdgeOrm.model_id == args.model_id)
            )
        ).all():
            existing.add(tuple(sorted((a, b))))  # type: ignore[arg-type]

        sections = (
            await session.execute(
                select(CrossSectionOrm.id, CrossSectionOrm.name)
                .where(CrossSectionOrm.app_project_id == project_id)
                .order_by(CrossSectionOrm.name)
            )
        ).all()

        total_new = 0
        total_existing = 0
        sections_with_new = 0
        # Model-wide de-dupe: the same planned pair can surface on two sections,
        # and the second insert would report it as skipped, not created.
        planned_seen: set[tuple[UUID, UUID]] = set()

        for sec_id, sec_name in sections:
            along = await project_investigations_onto_section(
                session, project_id=project_id, section_id=sec_id
            )
            plan = plan_enclosed_lens_merges(stacks, along)
            new_pairs = []
            skipped = 0
            for e in plan:
                pair = tuple(sorted((e.host_layer_id, e.neighbour_layer_id)))
                if pair in existing or pair in planned_seen:
                    skipped += 1
                    continue
                planned_seen.add(pair)  # type: ignore[arg-type]
                new_pairs.append(e)
            total_new += len(new_pairs)
            total_existing += skipped
            if new_pairs:
                sections_with_new += 1
            flag = "  <-- creates" if new_pairs else ""
            print(
                f"  {sec_name:<20} columns={len(along):>3}  planned={len(plan):>3}  "
                f"new={len(new_pairs):>3}  already={skipped:>3}{flag}"
            )
            for e in new_pairs:
                host = next(
                    (u for st in stacks.values() for u in st if u.layer_id == e.host_layer_id),
                    None,
                )
                nb = next(
                    (u for st in stacks.values() for u in st if u.layer_id == e.neighbour_layer_id),
                    None,
                )
                if host is None or nb is None:
                    continue
                print(
                    f"        {names.get(host.inv_id, '?'):<18} {host.soil:<5} "
                    f"{host.top_elev:>8.2f}/{host.base_elev:<8.2f} -> "
                    f"{names.get(nb.inv_id, '?'):<18} {nb.soil:<5} "
                    f"{nb.top_elev:>8.2f}/{nb.base_elev:<8.2f}"
                )

        print(
            f"\n  TOTAL: {total_new} net-new edge(s) across {sections_with_new} section(s); "
            f"{total_existing} planned edge(s) already exist.\n"
        )


if __name__ == "__main__":
    asyncio.run(main())
