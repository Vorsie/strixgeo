"""THROWAWAY DIAG — replay the tie-restatement predicate against the dev DB.

Owner dogfeed 2026-08-07: step 2 produced 322/322 born-accepted ties, but 127
of them are INTERIOR pairs (an endpoint is not the topmost sub-band of its
litho unit) — the refinement says those must arrive pending.  This script
re-runs the REAL derivation inputs (same loaders, same aligner, same
predicate expression) for every accepted edge of the current geotech model
and reports which edges the CURRENT code would have accepted vs proposed.

Read-only: SELECTs only, no session writes, no commit.

Run:  uv run python scripts/diag_tie_restatement_replay.py
"""

from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from datetime import UTC, datetime, timezone
from uuid import UUID

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel"
)

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from groundmodel.application.geotech_edge_derivation import (  # noqa: E402
    bridge_edges_over_bandless_columns,
    load_approved_litho_edges,
    load_litho_layer_depths,
    load_project_sections,
)
from groundmodel.domain.services.geotech_packing_edges import (  # noqa: E402
    aligned_same_class_pairs,
)
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

GEOTECH_MODEL = UUID("019fdd79-48c1-742e-b0fa-45a82f0f49ed")
_DEPTH_TOL_M = 0.001


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with AsyncSession(engine) as session:
        model = await session.get(GeologicalModelOrm, GEOTECH_MODEL)
        assert model is not None and model.parent_model_id is not None
        litho_model_id = model.parent_model_id
        project_id = model.app_project_id

        # Same band loader shape as AutoCorrelateGeotechEdges._load_geotech_bands.
        rows = (
            await session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    LithoLayerOrm.id,
                    LithoLayerOrm.formation_id,
                    GeologicalFormationOrm.nad_class,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                # Step-2 preconditions: at 18:25:58 no borehole band existed
                # yet (the divide wrote them at 18:28:32) — replay the CPT-only
                # world the auto-correlate actually saw.
                .where(LithoLayerOrm.model_id == GEOTECH_MODEL, LithoLayerOrm.cpt_id.isnot(None))
                .order_by(LithoLayerOrm.depth_top_m)
            )
        ).all()
        geotech_bands: dict[str, list[tuple[float, float, UUID, UUID, int | None]]] = defaultdict(
            list
        )
        for r in rows:
            inv = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
            geotech_bands[inv].append(
                (r.depth_top_m, r.depth_base_m, r.id, r.formation_id, r.nad_class)
            )

        litho_layer_depths = await load_litho_layer_depths(session, litho_model_id, None)
        sections = await load_project_sections(session, project_id)

        # Persisted approval per canonical pair (the step-2 edges).
        persisted = (
            await session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                    LithoContactCorrelationEdgeOrm.user_approved,
                    LithoContactCorrelationEdgeOrm.section_id,
                ).where(
                    LithoContactCorrelationEdgeOrm.model_id == GEOTECH_MODEL,
                    # Only the step-2 batch (18:25:58) — the divide's 18:28:32
                    # borehole-mediated edges are a different pass.
                    LithoContactCorrelationEdgeOrm.created_at
                    < datetime(2026, 8, 7, 18, 28, 0, tzinfo=UTC),
                )
            )
        ).all()
        persisted_by_pair: dict[tuple[UUID, UUID, UUID], bool] = {
            (sec, min(a, b), max(a, b)): approved for a, b, approved, sec in persisted
        }

        sorted_geotech = {inv: sorted(v, key=lambda t: t[0]) for inv, v in geotech_bands.items()}

        def stack(inv: str, lit_top: float, lit_base: float) -> list[tuple[str, int | None]]:
            out: list[tuple[str, int | None]] = []
            for top, base, layer_id, _fid, nad in sorted_geotech.get(inv, []):
                if top >= lit_top - _DEPTH_TOL_M and base <= lit_base + _DEPTH_TOL_M:
                    out.append((str(layer_id), nad))
            return out

        total = mism_accept = mism_pending = 0
        would_accept = would_pend = 0
        examples: list[str] = []
        for section in sections:
            approved = await load_approved_litho_edges(session, litho_model_id, section.id)
            if not approved:
                continue
            bridged = bridge_edges_over_bandless_columns(
                approved, litho_layer_depths, geotech_bands
            )
            for litho_a, litho_b in bridged:
                ea = litho_layer_depths.get(litho_a)
                eb = litho_layer_depths.get(litho_b)
                if ea is None or eb is None:
                    continue
                inv_a, top_a, base_a = ea
                inv_b, top_b, base_b = eb
                left = stack(inv_a, top_a, base_a)
                right = stack(inv_b, top_b, base_b)
                aligned = aligned_same_class_pairs(left, right)
                nad_by_layer = dict(left) | dict(right)
                pair_is_direct = (litho_a, litho_b) in approved
                for la, rb in aligned:
                    if nad_by_layer.get(la) is None:
                        continue
                    ga, gb = UUID(la), UUID(rb)
                    if ga == gb:
                        continue
                    ca, cb = (ga, gb) if ga < gb else (gb, ga)
                    code_says = (
                        pair_is_direct
                        and bool(left)
                        and bool(right)
                        and la == left[0][0]
                        and rb == right[0][0]
                    )
                    key = (section.id, ca, cb)
                    if key not in persisted_by_pair:
                        continue
                    total += 1
                    if code_says:
                        would_accept += 1
                    else:
                        would_pend += 1
                    db_says = persisted_by_pair[key]
                    if code_says != db_says:
                        if db_says:
                            mism_accept += 1
                        else:
                            mism_pending += 1
                        if len(examples) < 5:
                            examples.append(
                                f"section={section.name} litho={litho_a}~{litho_b} "
                                f"pair={ca}~{cb} code={'ACCEPT' if code_says else 'PEND'} "
                                f"db={'ACCEPT' if db_says else 'PEND'} "
                                f"left_top={left[0][0][-6:]} la={la[-6:]} "
                                f"right_top={right[0][0][-6:]} rb={rb[-6:]}"
                            )

        print(f"replayed pairs matched to persisted edges: {total}")
        print(f"current code would: accept={would_accept} pend={would_pend}")
        print(f"mismatches (db ACCEPT, code PEND): {mism_accept}")
        print(f"mismatches (db PEND, code ACCEPT): {mism_pending}")
        for e in examples:
            print(" ", e)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
