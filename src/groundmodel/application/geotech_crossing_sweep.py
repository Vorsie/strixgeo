"""Delete stored packing ties that cross another tie in the same gap.

Owner ruling, 2026-08-17: *"Ties shouldn't be able to cross, if any crossing ties
are in my test.strix it is because you generated them, not because i drew them"*
— and *"user made ties should be left alone"*.

Both halves were verified before this module was written.  All 14 edges behind
his four reported crossings are ``source='auto'``, and today's derivation,
replayed read-only on his real CS1 data, emits a perfectly monotone S9↔B3 gap.
So the emitter is already clean: the crossing guard refuses a crossing candidate
at emit time.  What his model carries are LEGACY rows from an older derivation,
which no emit-time guard can reach — the re-anchor preserves accepted ties across
every band rebuild, so they survive each press.  Hence a sweep over the stored
rows, run after both writers have had their say.

The arithmetic lives in
:mod:`~groundmodel.domain.services.geotech_crossing_repair` (pure); this module
is the DB half: load, judge, delete, report.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.geotech_crossing_repair import (
    PersistedTie,
    crossing_ties_to_delete,
)
from groundmodel.domain.services.geotech_edge_crossing_guard import gap_key
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

__all__ = ["sweep_crossing_ties"]


async def sweep_crossing_ties(
    session: AsyncSession, log: GroundModelLogger, geotech_model_id: UUID
) -> int:
    """Delete machine-made packing ties that cross another tie in their gap.

    Parameters
    ----------
    session : AsyncSession
        Active DB session; the DELETE is issued here and left to the caller's
        transaction.
    log : GroundModelLogger
        Logger of the calling use case, so the line reads with its phase.
    geotech_model_id : UUID
        The geotech model to repair.

    Returns
    -------
    int
        How many ties were deleted — 0 in the ordinary case, which leaves the
        model untouched.  Report it: a silent deletion of the engineer's
        correlations is exactly what he must never discover for himself.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.id,
                LithoContactCorrelationEdgeOrm.section_id,
                LithoContactCorrelationEdgeOrm.source,
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_a_side,
                LithoContactCorrelationEdgeOrm.layer_b_id,
                LithoContactCorrelationEdgeOrm.layer_b_side,
            ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
        )
    ).all()
    if not rows:
        return 0

    band_rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.cpt_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
            ).where(LithoLayerOrm.model_id == geotech_model_id)
        )
    ).all()
    # Depth below collar, not elevation: both differences the crossing test takes
    # are WITHIN one column, so the sign flip cancels (see the guard module).
    where: dict[UUID, tuple[str, float, float]] = {
        band.id: (str(band.borehole_id or band.cpt_id), band.depth_top_m, band.depth_base_m)
        for band in band_rows
    }

    ties: list[PersistedTie] = []
    for row in rows:
        home_a, home_b = where.get(row.layer_a_id), where.get(row.layer_b_id)
        if home_a is None or home_b is None:
            # An endpoint whose band no longer exists cannot be placed, so it
            # cannot be judged either. The FK cascade owns that row, not this.
            continue
        inv_a, top_a, base_a = home_a
        inv_b, top_b, base_b = home_b
        if inv_a == inv_b:
            continue  # spans no gap, so it crosses nothing
        depth_a = top_a if row.layer_a_side == "top" else base_a
        depth_b = top_b if row.layer_b_side == "top" else base_b
        gap = gap_key(inv_a, inv_b)
        first, second = (depth_a, depth_b) if gap[0] == inv_a else (depth_b, depth_a)
        ties.append(
            PersistedTie(
                edge_id=row.id,
                section_id=row.section_id,
                gap=gap,
                depth_first_m=first,
                depth_second_m=second,
                source=row.source,
            )
        )

    doomed = crossing_ties_to_delete(ties)
    if not doomed:
        return 0
    await session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(LithoContactCorrelationEdgeOrm.id.in_(doomed))
    )
    log.info(
        f"sweep_crossing_ties: deleted {len(doomed)} machine packing tie(s) that crossed "
        f"another tie in the same gap (of {len(ties)} judged); hand-drawn ties untouched"
    )
    return len(doomed)
