"""Delete machine PROPOSALS that tie a column their section does not draw.

Owner ruling, 2026-08-25 — shown a pending machine tie from GEO-10/170-S4 to
1411-GEO-23/126-B6 on Tie-section 7, where B6 stands 2.4 m from the line but
1.8 m BEFORE its start endpoint, so the section never draws it:
*"yeah make it section scoped ofcourse"*.

The emitter is fixed at its inputs — every geotech writer now reads them through
:func:`~groundmodel.application.geotech_edge_derivation.load_approved_litho_edge_sets`,
which takes the section's membership as a required argument — but a fixed
emitter cannot reach a row already in the table.  Those rows are
legacy: the projection filter gained its between-the-endpoints clamp on
2026-08-03, and every geotech press since has faithfully restated the
pre-clamp litho correlations that survived it.  A proposal on a gap the
engineer cannot see is one he can neither accept nor reject — it can only sit
in his review count forever.  Hence a sweep over the stored rows, run after the
derivation has had its say.

What it will not touch
----------------------
Only ``source='auto'`` rows that nobody has approved.  An ACCEPTED tie — or any
hand-drawn one — is the engineer's own statement about the ground, and this
module counts it and warns rather than deleting it: the mis-scoping is real,
but the judgment about his own line is his.  Mirrors the crossing sweep's rule
(*"user made ties should be left alone"*, 2026-08-17).

The pair itself is not lost.  A correlation between two columns is legitimate
on the section that DOES draw both, and that section's own run proposes it
there.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.section_membership import load_investigation_names
from groundmodel.domain.services.auto_correlate_contact_edges_constants import AUTO_SOURCE
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

__all__ = ["OffSectionSweepResult", "sweep_offsection_pending_ties"]


@dataclass(frozen=True)
class OffSectionSweepResult:
    """What one off-section sweep removed, and what it deliberately did not.

    Attributes
    ----------
    deleted : int
        Machine PROPOSALS removed — ``source='auto'`` and unapproved, with at
        least one endpoint on a column their section does not draw.
    retained : int
        Mis-scoped ties left in place because they are ACCEPTED or hand-drawn.
        Reported at WARNING: the rows are wrong for their section but they
        carry the engineer's judgment, so only he may take them back.
    """

    deleted: int = 0
    retained: int = 0


async def sweep_offsection_pending_ties(
    session: AsyncSession,
    log: GroundModelLogger,
    *,
    geotech_model_id: UUID,
    members_by_section: dict[UUID, set[UUID]],
) -> OffSectionSweepResult:
    """Remove unapproved machine ties whose section does not draw both columns.

    Parameters
    ----------
    session : AsyncSession
        Active DB session; the DELETE is issued here and left to the caller's
        transaction.
    log : GroundModelLogger
        Logger of the calling use case, so the lines read with its phase.
    geotech_model_id : UUID
        The geotech model to repair.
    members_by_section : dict[UUID, set[UUID]]
        ``{section_id: {investigation_id, ...}}`` for the sections in scope
        (see
        :func:`~groundmodel.application.section_membership.load_members_by_section`).
        An edge whose ``section_id`` is absent from this map is OUT of scope and
        is left completely alone — a section-scoped press must not reach across
        into a section the engineer did not ask about.

    Returns
    -------
    OffSectionSweepResult
        How many proposals were removed and how many mis-scoped hand/accepted
        ties were left standing.  Report both: a silent deletion is exactly
        what the engineer must never discover for himself, and a mis-scoped tie
        he approved is a decision only he can revisit.
    """
    if not members_by_section:
        return OffSectionSweepResult()

    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.id,
                LithoContactCorrelationEdgeOrm.section_id,
                LithoContactCorrelationEdgeOrm.source,
                LithoContactCorrelationEdgeOrm.user_approved,
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                LithoContactCorrelationEdgeOrm.section_id.in_(members_by_section.keys()),
            )
        )
    ).all()
    if not rows:
        log.debug(
            f"sweep_offsection_pending_ties: model={geotech_model_id} carries no edge on the "
            f"{len(members_by_section)} section(s) in scope — nothing to judge"
        )
        return OffSectionSweepResult()

    band_rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.cpt_id,
            ).where(LithoLayerOrm.model_id == geotech_model_id)
        )
    ).all()
    # Borehole first, then CPT — the same keying every other geotech reader uses,
    # so "which column is this band on?" has one answer across the module set.
    column_of: dict[UUID, UUID] = {}
    for band in band_rows:
        column = band.borehole_id if band.borehole_id is not None else band.cpt_id
        if column is not None:
            column_of[band.id] = column

    doomed: list[UUID] = []
    retained: list[tuple[Any, set[UUID]]] = []
    unplaceable = 0
    for row in rows:
        members = members_by_section[row.section_id]
        column_a = column_of.get(row.layer_a_id)
        column_b = column_of.get(row.layer_b_id)
        if column_a is None or column_b is None:
            # An endpoint whose band no longer exists cannot be placed on a
            # column, so it cannot be judged either. The FK cascade owns that
            # row, not this sweep.
            unplaceable += 1
            continue
        off_section = {column for column in (column_a, column_b) if column not in members}
        if not off_section:
            continue
        if row.source == AUTO_SOURCE and not row.user_approved:
            doomed.append(row.id)
            continue
        retained.append((row, off_section))

    if retained:
        # Names resolved once for every retained row, then formatted per row:
        # a uuid in this line is unreadable, and the whole point of the WARNING
        # is that the engineer can go and look at the column it names.
        names = await load_investigation_names(
            session, {column for _row, columns in retained for column in columns}
        )
        for row, off_section in retained:
            # WARNING, not DEBUG: the row is wrong for its section AND it is the
            # engineer's own — the two facts together are a decision he has to
            # make, so the line names the edge and the column that is not drawn.
            log.warning(
                f"sweep_offsection_pending_ties: edge {row.id} on section {row.section_id} ties "
                f"{len(off_section)} column(s) the section does not draw "
                f"({', '.join(sorted(names.get(c, str(c)) for c in off_section))}) — kept because "
                f"it is {'accepted' if row.user_approved else 'hand-drawn'} "
                f"(source={row.source!r}, user_approved={row.user_approved})"
            )

    if unplaceable:
        log.debug(
            f"sweep_offsection_pending_ties: {unplaceable} edge(s) skipped — an endpoint band "
            f"no longer exists, so the tie cannot be placed on a column"
        )
    if not doomed:
        log.debug(
            f"sweep_offsection_pending_ties: judged {len(rows)} edge(s) across "
            f"{len(members_by_section)} section(s); nothing to remove"
        )
        return OffSectionSweepResult(deleted=0, retained=len(retained))

    await session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(LithoContactCorrelationEdgeOrm.id.in_(doomed))
    )
    log.info(
        f"sweep_offsection_pending_ties: deleted {len(doomed)} unapproved machine tie(s) whose "
        f"section does not draw both columns (of {len(rows)} judged); {len(retained)} accepted or "
        f"hand-drawn mis-scoped tie(s) left untouched"
    )
    return OffSectionSweepResult(deleted=len(doomed), retained=len(retained))
