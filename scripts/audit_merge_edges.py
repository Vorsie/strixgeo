"""Audit — and optionally REVERT — the edges the enclosed-lens merge created.

The merge (debt #243) unifies bodies by inserting ``manual`` correlation edges.
Those edges are indistinguishable in the schema from ties the owner drew by hand,
and they RENDER as correlation lines on the section — so a badly-chosen one is
both visible and, once it merges two bodies that should stay apart, load-bearing
for the 3-D blend.

This script reads ``scripts/merge_edges_2026_07_28.json`` (the net-new set that
Build created, captured from the dry run BEFORE it ran), resolves every entry to
real layer ids, and reports for each:

* **vertical span overlap** between the two tied units. A tie whose endpoints do
  not overlap at all is a line that jumps across intervening lithologies — the
  "weird crossing correlation" shape.
* whether the edge is still present in the DB.

``--apply-revert`` then deletes exactly those edges and re-runs
``ResolveLithoInstances``, restoring the body ids to their pre-Build state. It
refuses to run unless every entry resolves uniquely and is present, so a partial
or mis-transcribed list can never half-revert the model.

Read-only by default, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/audit_merge_edges.py
    uv run python scripts/audit_merge_edges.py --apply-revert
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

from sqlalchemy import delete, select  # noqa: E402

from groundmodel.application.resolve_litho_instances_use_case import (  # noqa: E402
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
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

_DEFAULT_LIST = _REPO_ROOT / "scripts" / "merge_edges_2026_07_28.json"

#: Elevations in the captured list are rounded to 2 decimals; match within half
#: a centimetre so a rounded value still resolves to exactly one layer.
_MATCH_TOL_M = 0.006


async def main() -> None:
    """Audit the captured merge edges; with ``--apply-revert``, remove them."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", type=Path, default=_DEFAULT_LIST)
    ap.add_argument(
        "--apply-revert",
        action="store_true",
        help="DELETE the listed edges and re-resolve body identity (writes!)",
    )
    args = ap.parse_args()

    print("\n=== ENCLOSED-LENS MERGE EDGE AUDIT ===\n")
    _confirm_db_target()

    spec = json.loads(args.list.read_text(encoding="utf-8"))
    model_id = UUID(spec["model_id"])
    entries = spec["edges"]
    print(f"  list: {args.list.name} — {len(entries)} edge(s), model {model_id}\n")

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {model_id} not found.")
        project_id = model.app_project_id

        surf: dict[UUID, float] = {}
        by_name: dict[str, UUID] = {}
        for orm in (CptOrm, BoreholeOrm):
            for r in (
                await session.execute(
                    select(orm.id, orm.name, orm.elevation_m).where(
                        orm.app_project_id == project_id
                    )
                )
            ).all():
                by_name[r.name] = r.id
                surf[r.id] = float(r.elevation_m or 0.0)

        # Every accepted layer as (investigation, soil, top_elev, base_elev).
        layers: list[tuple[UUID, UUID, str, float, float]] = []
        for r in (
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
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all():
            inv = r.cpt_id if r.cpt_id is not None else r.borehole_id
            if inv is None or inv not in surf:
                continue
            s = surf[inv]
            layers.append(
                (r.id, inv, r.litho_main_soil_code or "", s - r.depth_top_m, s - r.depth_base_m)
            )

        def _find(name: str, soil: str, top: float, base: float) -> list[UUID]:
            """Layer ids matching an investigation + soil + rounded elevations."""
            inv = by_name.get(name)
            if inv is None:
                return []
            return [
                lid
                for lid, i, sc, t, b in layers
                if i == inv
                and sc == soil
                and abs(t - top) <= _MATCH_TOL_M
                and abs(b - base) <= _MATCH_TOL_M
            ]

        existing_pairs: set[tuple[UUID, UUID]] = set()
        for a, b in (
            await session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                ).where(LithoContactCorrelationEdgeOrm.model_id == model_id)
            )
        ).all():
            existing_pairs.add((a, b))
            existing_pairs.add((b, a))

        unresolved: list[str] = []
        absent: list[str] = []
        resolved: list[tuple[str, UUID, UUID]] = []
        no_overlap: list[str] = []

        for sec, an, asoil, atop, abase, bn, bsoil, btop, bbase in entries:
            a_ids = _find(an, asoil, atop, abase)
            b_ids = _find(bn, bsoil, btop, bbase)
            label = (
                f"{sec:<16} {an:<19}{asoil} {atop:>7.2f}/{abase:<7.2f} -> "
                f"{bn:<19}{bsoil} {btop:>7.2f}/{bbase:<7.2f}"
            )
            if len(a_ids) != 1 or len(b_ids) != 1:
                unresolved.append(f"{label}   (matched {len(a_ids)} x {len(b_ids)})")
                continue
            if (a_ids[0], b_ids[0]) not in existing_pairs:
                absent.append(label)
                continue
            resolved.append((label, a_ids[0], b_ids[0]))
            # Vertical overlap of the two tied units. <= 0 means the correlation
            # line jumps across whatever lies between them.
            overlap = min(atop, btop) - max(abase, bbase)
            if overlap <= 0:
                no_overlap.append(f"{label}   gap {-overlap:.2f} m")

        print(f"  resolved + present in DB : {len(resolved)}")
        print(f"  could not resolve        : {len(unresolved)}")
        print(f"  resolved but NOT in DB   : {len(absent)}")
        for line in unresolved:
            print(f"      UNRESOLVED {line}")
        for line in absent:
            print(f"      ABSENT     {line}")

        print(
            f"\n  --- ties whose two units do NOT overlap vertically: "
            f"{len(no_overlap)} of {len(resolved)} ---"
        )
        print("  (a correlation line that jumps across the lithologies in between)")
        for line in sorted(no_overlap):
            print(f"      {line}")

        if not args.apply_revert:
            print("\n  READ-ONLY. Re-run with --apply-revert to remove these edges.\n")
            return

        # An UNRESOLVED entry is dangerous: the list no longer describes this
        # model, so a delete could hit the wrong row. An ABSENT entry is not — it
        # simply means the merge never created that one (the planner's output
        # depends on the layer geometry, which can drift between the capture and
        # the Build), so there is nothing to remove.
        if unresolved:
            raise SystemExit(
                "\nABORT: some listed edges do not resolve to exactly one layer pair. "
                "The list no longer describes this model — fix it before reverting."
            )

        ids = [lid for _label, a, b in resolved for lid in (a, b)]
        print(f"\n  REVERTING: deleting {len(resolved)} edge(s) …")
        removed = 0
        for _label, a, b in resolved:
            res = await session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id.in_([a, b]),
                    LithoContactCorrelationEdgeOrm.layer_b_id.in_([a, b]),
                )
            )
            removed += res.rowcount or 0
        print(f"  deleted {removed} row(s); re-resolving body identity …")
        await ResolveLithoInstances(session).execute(model_id=model_id, commit=False)
        await session.commit()

        bodies = (
            await session.execute(
                select(LithoLayerOrm.body_id)
                .where(LithoLayerOrm.model_id == model_id, LithoLayerOrm.status == "accepted")
                .distinct()
            )
        ).all()
        print(f"  done — {len(bodies)} distinct body id(s) now (was 61 post-merge).")
        print("  The 3-D solids are NOT rebuilt: click Build in the app.\n")
        assert ids  # touched only to keep the resolved ids referenced


if __name__ == "__main__":
    asyncio.run(main())
