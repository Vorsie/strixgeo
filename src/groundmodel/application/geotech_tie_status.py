"""How much packing-correlation work is still waiting for the engineer.

The four-step geotech pipeline (owner ruling 2026-08-04) puts an explicit
acceptance step between "auto-correlate packing" and "divide boreholes":

1. subdivide CPTs into packing — bands only,
2. auto-correlate packing — PROPOSES ties,
3. accept — per tie, or all of them,
4. divide boreholes — gated on step 3 being finished.

Two callers need the same three numbers: the ``tie-status`` endpoint, so the
button can say why it is disabled, and the divide-boreholes gate, so pressing
it anyway fails with the pending count rather than silently dividing on
half-reviewed evidence.  Counting is a single grouped query — cheap enough to
ask on every accept.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)


@dataclass(frozen=True)
class GeotechTieStatus:
    """Counts of a geotech model's packing ties by approval state.

    Attributes
    ----------
    pending_tie_count : int
        Proposed ties (``user_approved=False``) awaiting the accept verb.
    accepted_tie_count : int
        Ties the engineer accepted — the only ones the resolver, the fill and
        the 3-D build ever see.
    flagged_tie_count : int
        Accepted ties carrying a ``review_reason``.  They are accepted (and so
        included in ``accepted_tie_count``) and gate nothing; the count exists
        so the UI can nudge.
    """

    pending_tie_count: int
    accepted_tie_count: int
    flagged_tie_count: int


async def load_geotech_tie_status(
    session: AsyncSession, geotech_model_id: UUID
) -> GeotechTieStatus:
    """Count a geotech model's packing ties by approval state.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    geotech_model_id : UUID
        The geotechnical model whose correlation edges are counted.

    Returns
    -------
    GeotechTieStatus
        Pending / accepted / flagged counts.  All three are ``0`` for a model
        with no edges at all, which is the state ``subdivide-cpts`` leaves.
    """
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.user_approved,
                LithoContactCorrelationEdgeOrm.review_reason.is_not(None).label("flagged"),
                func.count(),
            )
            .where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
            .group_by(
                LithoContactCorrelationEdgeOrm.user_approved,
                LithoContactCorrelationEdgeOrm.review_reason.is_not(None),
            )
        )
    ).all()
    pending = accepted = flagged = 0
    for approved, is_flagged, count in rows:
        if approved:
            accepted += count
            if is_flagged:
                flagged += count
        else:
            pending += count
    return GeotechTieStatus(
        pending_tie_count=pending,
        accepted_tie_count=accepted,
        flagged_tie_count=flagged,
    )
