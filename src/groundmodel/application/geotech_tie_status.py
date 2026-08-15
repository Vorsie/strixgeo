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
    pending_by_section : dict[UUID, int]
        Pending ties broken down by the section they were authored on, sections
        with none omitted.  Added for the section-scoped pipeline (owner ruling
        2026-08-15, *"this is model wide and not per section, i don't like
        that"*): steps 2 and 3 now act on the open section, but step 4 stays
        model-wide, so the toolbar must be able to say WHICH other sections are
        holding the divide shut — and to report the open section's own count
        rather than a model total the engineer cannot act on where he is
        standing.  Ties with no section (there should be none — the column is
        NOT NULL) are counted in ``pending_tie_count`` only.
    """

    pending_tie_count: int
    accepted_tie_count: int
    flagged_tie_count: int
    pending_by_section: dict[UUID, int]


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
        Pending / accepted / flagged counts plus the per-section pending
        breakdown.  All three counts are ``0`` and the breakdown empty for a
        model with no edges at all, which is the state ``subdivide-cpts``
        leaves.
    """
    # The section is in the GROUP BY so the per-section breakdown costs no
    # second query; the three model totals are summed back out of the same
    # rows.
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.user_approved,
                LithoContactCorrelationEdgeOrm.review_reason.is_not(None).label("flagged"),
                LithoContactCorrelationEdgeOrm.section_id,
                func.count(),
            )
            .where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
            .group_by(
                LithoContactCorrelationEdgeOrm.user_approved,
                LithoContactCorrelationEdgeOrm.review_reason.is_not(None),
                LithoContactCorrelationEdgeOrm.section_id,
            )
        )
    ).all()
    pending = accepted = flagged = 0
    pending_by_section: dict[UUID, int] = {}
    for approved, is_flagged, section_id, count in rows:
        if approved:
            accepted += count
            if is_flagged:
                flagged += count
        else:
            pending += count
            if section_id is not None:
                pending_by_section[section_id] = pending_by_section.get(section_id, 0) + count
    return GeotechTieStatus(
        pending_tie_count=pending,
        accepted_tie_count=accepted,
        flagged_tie_count=flagged,
        pending_by_section=pending_by_section,
    )
